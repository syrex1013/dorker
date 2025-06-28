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
    const fullPath = path.resolve(filePath);
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
 * Save URLs to a text file, one per line
 * @param {Object} results - Results object containing dorks and their results
 * @param {string} filePath - Path to save the URLs file
 * @param {Object} logger - Winston logger instance
 */
async function saveUrlsToFile(results, filePath, logger = null) {
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

    // Remove duplicates
    const uniqueUrls = [...new Set(urls)];

    // Save one URL per line
    const urlContent = uniqueUrls.join("\n") + "\n";
    await fs.writeFile(filePath, urlContent, "utf8");

    logger?.info("URLs saved to file", {
      filePath,
      urlCount: uniqueUrls.length,
      totalFound: urls.length,
      duplicatesRemoved: urls.length - uniqueUrls.length,
    });

    logWithDedup(
      "info",
      `💾 Saved ${uniqueUrls.length} unique URLs to ${path.basename(filePath)}`,
      chalk.green,
      logger
    );
    if (urls.length > uniqueUrls.length) {
      logWithDedup(
        "info",
        `   (${urls.length - uniqueUrls.length} duplicates removed)`,
        chalk.blue,
        logger
      );
    }
  } catch (error) {
    logger?.error("Failed to save URLs to file", {
      error: error.message,
      filePath,
    });
    console.error(chalk.red(`❌ Failed to save URLs: ${error.message}`));
  }
}

export { loadDorks, saveResults, appendDorkResults, saveUrlsToFile };
