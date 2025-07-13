import fs from "fs/promises";
import path from "path";
import chalk from "chalk";
import { logWithDedup } from "./logger.js";

/**
 * Check if two dorks are similar (to detect duplicates)
 * @param {string} dork1 - First dork
 * @param {string} dork2 - Second dork
 * @returns {boolean} True if dorks are similar
 */
function areDorksSimilar(dork1, dork2) {
  // Exact match
  if (dork1 === dork2) return true;

  // Normalize dorks for comparison
  const normalize = (dork) =>
    dork.toLowerCase().replace(/\s+/g, " ").replace(/\*+/g, "*").trim();

  const norm1 = normalize(dork1);
  const norm2 = normalize(dork2);

  // Exact match after normalization
  if (norm1 === norm2) return true;

  // Extract key components for similarity check
  const extractComponents = (dork) => {
    const components = {
      intext: (dork.match(/intext:([^\s]+)/i) || [])[1] || "",
      site: (dork.match(/site:([^\s]+)/i) || [])[1] || "",
      filetype: (dork.match(/(?:filetype|ext):([^\s]+)/i) || [])[1] || "",
      intitle: (dork.match(/intitle:([^\s]+)/i) || [])[1] || "",
      inurl: (dork.match(/inurl:([^\s]+)/i) || [])[1] || "",
      host: (dork.match(/host:([^\s]+)/i) || [])[1] || "",
    };
    return components;
  };

  const comp1 = extractComponents(norm1);
  const comp2 = extractComponents(norm2);

  // Check if core components are identical (indicating similar intent)
  const sameIntext =
    comp1.intext &&
    comp2.intext &&
    comp1.intext.replace(/\*/g, "") === comp2.intext.replace(/\*/g, "");
  const sameFiletype =
    comp1.filetype && comp2.filetype && comp1.filetype === comp2.filetype;
  const sameSite = comp1.site && comp2.site && comp1.site === comp2.site;
  const sameHost =
    comp1.host &&
    comp2.host &&
    comp1.host.replace(/\*/g, "").replace(/\./g, "") ===
      comp2.host.replace(/\*/g, "").replace(/\./g, "");

  // Consider similar if they have same intext + filetype, or same core search terms
  if (sameIntext && sameFiletype) return true;
  if (sameHost && sameIntext) return true;
  if (sameSite && sameIntext) return true;

  return false;
}

/**
 * Remove duplicate and similar dorks from array
 * @param {string[]} dorks - Array of dorks
 * @param {Object} logger - Winston logger instance
 * @returns {string[]} Deduplicated array of dorks
 */
function deduplicateDorks(dorks, logger = null) {
  const uniqueDorks = [];
  const removed = [];

  for (const dork of dorks) {
    let isDuplicate = false;

    for (const existingDork of uniqueDorks) {
      if (areDorksSimilar(dork, existingDork)) {
        isDuplicate = true;
        removed.push({ original: existingDork, duplicate: dork });
        break;
      }
    }

    if (!isDuplicate) {
      uniqueDorks.push(dork);
    }
  }

  if (removed.length > 0) {
    logger?.info("Removed similar/duplicate dorks", {
      originalCount: dorks.length,
      uniqueCount: uniqueDorks.length,
      removed: removed.length,
    });

    logWithDedup(
      "info",
      `🔄 Removed ${removed.length} similar/duplicate dorks (${uniqueDorks.length} unique remain)`,
      chalk.yellow,
      logger
    );

    // Log details of removed dorks for user information
    removed.forEach(({ original, duplicate }) => {
      logger?.debug("Removed duplicate dork", { original, duplicate });
    });
  }

  return uniqueDorks;
}

/**
 * Loads dorks from a specified file.
 * @param {string} filePath - The path to the dork file.
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<string[]>} A promise that resolves to an array of dorks.
 */
async function loadDorks(filePath, logger = null) {
  try {
    logger?.info("Loading dorks from file", { filePath });
    const fullPath = path.resolve(filePath);
    const data = await fs.readFile(fullPath, "utf-8");
    const rawDorks = data
      .split("\n")
      .map((dork) => dork.trim())
      .filter((dork) => dork && !dork.startsWith("#"));

    // Remove duplicates and similar dorks
    const dorks = deduplicateDorks(rawDorks, logger);

    logger?.info("Dorks loaded successfully", {
      rawCount: rawDorks.length,
      uniqueCount: dorks.length,
      filePath,
    });
    logWithDedup(
      "info",
      `[+] Loaded ${dorks.length} unique dorks from ${filePath}`,
      chalk.green,
      logger
    );
    return dorks;
  } catch (error) {
    logger?.error("Error loading dorks file", {
      filePath,
      error: error.message,
    });
    console.error(
      chalk.red(`[!] Error reading dork file at ${filePath}: ${error.message}`)
    );
    process.exit(1);
  }
}

/**
 * Saves the collected results to a JSON file.
 * @param {object} data - The data to save.
 * @param {string} filePath - The path to the output file.
 * @param {Object} logger - Winston logger instance
 */
async function saveResults(data, filePath, logger = null) {
  try {
    logger?.info("Saving results to file", {
      filePath,
      resultCount: Object.keys(data).length,
    });
    
    // Add timestamp to filename
    const pathInfo = path.parse(filePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T');
    const dateStr = timestamp[0]; // YYYY-MM-DD
    const timeStr = timestamp[1].split('.')[0]; // HH-MM-SS
    const timestampedPath = path.join(
      pathInfo.dir,
      `${pathInfo.name}_${dateStr}_${timeStr}${pathInfo.ext}`
    );
    
    const fullPath = path.resolve(timestampedPath);
    await fs.writeFile(fullPath, JSON.stringify(data, null, 2), "utf-8");
    logger?.info("Results saved successfully", { filePath: fullPath });
    logWithDedup(
      "info",
      `\n[+] Results saved successfully to ${fullPath}`,
      chalk.green,
      logger
    );
  } catch (error) {
    logger?.error("Error saving results", { filePath, error: error.message });
    console.error(
      chalk.red(`[!] Error saving results to ${filePath}: ${error.message}`)
    );
  }
}

/**
 * Appends results for a single dork to the output file immediately
 * @param {string} dork - The dork query
 * @param {Array} results - The results for this dork
 * @param {string} filePath - The path to the output file
 * @param {object} allResults - All results collected so far
 * @param {Object} logger - Winston logger instance
 */
async function appendDorkResults(
  dork,
  results,
  filePath,
  allResults,
  logger = null
) {
  if (!filePath || !results || results.length === 0) return;

  try {
    logger?.debug("Appending dork results to output file", {
      dork: dork.substring(0, 50),
      resultCount: results.length,
      filePath,
    });

    // Update the all results object
    allResults[dork] = results;

    // Save the updated results immediately
    const fullPath = path.resolve(filePath);
    await fs.writeFile(fullPath, JSON.stringify(allResults, null, 2), "utf-8");

    logger?.info("Dork results appended successfully", {
      dork: dork.substring(0, 50),
      resultCount: results.length,
      totalDorks: Object.keys(allResults).length,
    });
  } catch (error) {
    logger?.error("Error appending dork results", {
      dork: dork.substring(0, 50),
      error: error.message,
    });
  }
}

/**
 * Extract hostname from URL
 * @param {string} url - The URL to extract hostname from
 * @returns {string|null} The hostname or null if invalid
 */
function extractHostname(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Appends an array of URLs to a text file, filtering out URLs with hosts that already exist
 * @param {string[]} urls - The URLs to append
 * @param {string} filePath - The path to the output file
 * @param {Object} logger - Winston logger instance
 */
async function appendUrlsToFile(urls, filePath, logger = null) {
  if (!filePath || !urls || urls.length === 0) return;

  try {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Read existing URLs to get existing hosts
    let existingHosts = new Set();
    try {
      const existingContent = await fs.readFile(filePath, 'utf8');
      const existingUrls = existingContent.split('\n').filter(line => line.trim());
      
      for (const existingUrl of existingUrls) {
        const host = extractHostname(existingUrl.trim());
        if (host) {
          existingHosts.add(host);
        }
      }
      
      logger?.debug(`Found ${existingHosts.size} existing hosts in ${filePath}`);
    } catch {
      // File doesn't exist yet, create it
      await fs.writeFile(filePath, '', 'utf8');
      logger?.debug(`Created new file: ${filePath}`);
    }

    // Filter URLs to only include those with new hosts
    const filteredUrls = [];
    const skippedUrls = [];
    
    for (const url of urls) {
      const host = extractHostname(url);
      if (!host) {
        skippedUrls.push({ url, reason: 'Invalid URL' });
        continue;
      }
      
      if (existingHosts.has(host)) {
        skippedUrls.push({ url, reason: `Host '${host}' already exists` });
        continue;
      }
      
      // Add to filtered list and mark host as seen
      filteredUrls.push(url);
      existingHosts.add(host);
    }

    // Log filtering results
    if (skippedUrls.length > 0) {
      logger?.info(`Filtered out ${skippedUrls.length} URLs with existing hosts`, {
        filePath,
        skippedCount: skippedUrls.length,
        newCount: filteredUrls.length,
        totalCount: urls.length
      });
      
      // Log details about skipped URLs
      skippedUrls.forEach(({ url, reason }) => {
        logger?.debug(`Skipped URL: ${url} (${reason})`);
      });
    }

    // Append only URLs with new hosts
    if (filteredUrls.length > 0) {
      const urlContent = filteredUrls.join("\n") + "\n";
      await fs.appendFile(filePath, urlContent, "utf8");
      logger?.info(`Appended ${filteredUrls.length} URLs with new hosts to ${filePath}`, {
        newHosts: filteredUrls.length,
        skippedExisting: skippedUrls.length,
        totalProcessed: urls.length
      });
    } else {
      logger?.info(`No new hosts found - all ${urls.length} URLs were filtered out`, {
        filePath,
        reason: 'All hosts already exist in file'
      });
    }
  } catch (error) {
    logger?.error("Error appending URLs to file", {
      filePath,
      error: error.message,
    });
    throw error; // Re-throw to handle in the calling function
  }
}

/**
 * Save URLs to a text file, one per line
 * @param {Object} results - Results object containing dorks and their results
 * @param {string} filePath - Path to save the URLs file
 * @param {Object} logger - Winston logger instance
 * @param {boolean} includeAll - Whether to include duplicates (default: false)
 */
async function saveUrlsToFile(
  results,
  filePath,
  logger = null,
  includeAll = false
) {
  try {
    const urls = [];

    // Extract all URLs from all dorks
    for (const dork in results) {
      if (results[dork] && Array.isArray(results[dork])) {
        results[dork].forEach((result) => {
          if (result.url && result.url.trim()) {
            urls.push(result.url.trim());
          }
        });
      }
    }

    if (urls.length === 0) {
      logger?.warn("No URLs found to save");
      return;
    }

    let urlsToSave;
    let duplicateCount = 0;
    let hostFilteredCount = 0;

    if (includeAll) {
      urlsToSave = urls;
      duplicateCount = urls.length - [...new Set(urls)].length;
    } else {
      // Remove exact URL duplicates first
      const uniqueUrls = [...new Set(urls)];
      duplicateCount = urls.length - uniqueUrls.length;
      
      // Then filter by host to keep only one URL per host
      const seenHosts = new Set();
      const hostFilteredUrls = [];
      
      for (const url of uniqueUrls) {
        const host = extractHostname(url);
        if (!host) {
          continue; // Skip invalid URLs
        }
        
        if (!seenHosts.has(host)) {
          seenHosts.add(host);
          hostFilteredUrls.push(url);
        }
      }
      
      hostFilteredCount = uniqueUrls.length - hostFilteredUrls.length;
      urlsToSave = hostFilteredUrls;
    }

    // Create filename with timestamp and type indicator
    const pathInfo = path.parse(filePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T');
    const dateStr = timestamp[0]; // YYYY-MM-DD
    const timeStr = timestamp[1].split('.')[0]; // HH-MM-SS
    const typeIndicator = includeAll ? "-all" : "-unique";
    const finalPath = path.join(
      pathInfo.dir,
      `${pathInfo.name}_${dateStr}_${timeStr}${typeIndicator}${pathInfo.ext}`
    );

    // Save one URL per line
    const urlContent = urlsToSave.join("\n") + "\n";
    await fs.writeFile(finalPath, urlContent, "utf8");

    logger?.info("URLs saved to file", {
      filePath: finalPath,
      urlCount: urlsToSave.length,
      totalFound: urls.length,
      duplicatesRemoved: duplicateCount,
      hostFilteredCount: hostFilteredCount,
      includeAll,
    });

    const typeDescription = includeAll ? "all" : "unique hosts";
    logWithDedup(
      "info",
      `💾 Saved ${urlsToSave.length} ${typeDescription} URLs to ${path.basename(
        finalPath
      )}`,
      chalk.green,
      logger
    );

    if (duplicateCount > 0 || hostFilteredCount > 0) {
      let filterMessage = "";
      if (includeAll) {
        filterMessage = `   (including ${duplicateCount} duplicates)`;
      } else {
        const parts = [];
        if (duplicateCount > 0) parts.push(`${duplicateCount} exact duplicates`);
        if (hostFilteredCount > 0) parts.push(`${hostFilteredCount} duplicate hosts`);
        filterMessage = `   (${parts.join(', ')} removed)`;
      }
      logWithDedup("info", filterMessage, chalk.blue, logger);
    }

    // Also save the alternate version for comparison
    const altTypeIndicator = includeAll ? "-unique" : "-all";
    const altPath = path.join(
      pathInfo.dir,
      `${pathInfo.name}_${dateStr}_${timeStr}${altTypeIndicator}${pathInfo.ext}`
    );
    const altUrls = includeAll ? [...new Set(urls)] : urls;
    const altContent = altUrls.join("\n") + "\n";

    await fs.writeFile(altPath, altContent, "utf8");

    const altTypeDescription = includeAll ? "unique" : "all";
    logWithDedup(
      "info",
      `💾 Also saved ${
        altUrls.length
      } ${altTypeDescription} URLs to ${path.basename(altPath)}`,
      chalk.cyan,
      logger
    );
  } catch (error) {
    logger?.error("Failed to save URLs to file", {
      error: error.message,
      filePath,
    });
    console.error(chalk.red(`❌ Failed to save URLs: ${error.message}`));
  }
}

export {
  loadDorks,
  saveResults,
  appendDorkResults,
  appendUrlsToFile,
  saveUrlsToFile,
};
