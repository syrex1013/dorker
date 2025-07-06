import chalk from "chalk";
import { sleep } from "../utils/sleep.js";
import { logWithDedup } from "../utils/logger.js";
import {
  testAsocksAPI,
  generateProxy,
  deleteProxy,
} from "../proxy/asocksApi.js";
import { handleCaptcha } from "../captcha/detector.js";
import {
  launchBrowser,
  createPage,
  performWarmup,
  navigateToGoogle,
  closeBrowser,
} from "../browser/browserManager.js";
import BackgroundCaptchaMonitor from "../captcha/backgroundMonitor.js";
import { SEARCH_ENGINES } from "../constants/searchEngines.js";

/**
 * Multi-Engine Dorker class for performing Google dorking with anti-detection
 */
export class MultiEngineDorker {
  constructor(config, logger = null, dashboard = null) {
    this.config = config;
    this.logger = logger;
    this.dashboard = dashboard;
    this.browser = null;
    this.pageData = null;
    this.currentProxy = null;
    this.searchCount = 0;
    this.restartThreshold = 5; // Restart browser every 5 searches
    this.backgroundMonitor = null; // Background CAPTCHA monitor
  }

  /**
   * Initialize the dorker
   */
  async initialize() {
    try {
      this.logger?.info("Initializing MultiEngineDorker");

      // Test ASOCKS API if proxy mode is enabled
      if (this.config.autoProxy) {
        const apiWorks = await testAsocksAPI(this.logger);
        if (!apiWorks) {
          logWithDedup(
            "warning",
            "⚠️ ASOCKS API test failed, disabling auto proxy",
            chalk.yellow,
            this.logger
          );
          this.config.autoProxy = false;
        }
      }

      // Launch browser
      await this.launchBrowserInstance();

      this.logger?.info("MultiEngineDorker initialized successfully");
    } catch (error) {
      this.logger?.error("Failed to initialize MultiEngineDorker", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Launch browser instance
   */
  async launchBrowserInstance() {
    try {
      this.logger?.info("Launching browser instance");

      const { browser, firstPage } = await launchBrowser(
        this.config,
        this.logger
      );
      this.browser = browser;
      const { page, cursor } = await createPage(
        this.browser,
        this.config,
        this.logger,
        firstPage
      );

      // Create pageData with dashboard included
      this.pageData = {
        page,
        cursor,
        dashboard: this.dashboard,
      };

      // Perform warm-up session if human-like behavior is enabled
      if (this.config.humanLike) {
        await performWarmup(this.pageData, this.logger);
      } else {
        // Just navigate to Google if no warm-up
        await navigateToGoogle(this.pageData, this.logger);
      }

      // Initialize background CAPTCHA monitor
      this.backgroundMonitor = new BackgroundCaptchaMonitor(
        this.pageData,
        this.config,
        this.logger,
        this.dashboard,
        async () => await this.switchProxy() // Proxy switch callback
      );

      // Start background monitoring
      this.backgroundMonitor.start();

      this.logger?.info("Browser instance launched successfully");
    } catch (error) {
      this.logger?.error("Failed to launch browser instance", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Restart browser instance
   */
  async restartBrowser() {
    try {
      this.logger?.info("Restarting browser instance");
      logWithDedup(
        "info",
        "🔄 Restarting browser for fresh session...",
        chalk.blue,
        this.logger
      );

      // Stop background monitor
      if (this.backgroundMonitor) {
        this.backgroundMonitor.stop();
        this.backgroundMonitor = null;
      }

      // Close current browser
      if (this.browser) {
        await closeBrowser(this.browser, this.logger);
      }

      // Clean up proxy if exists
      if (this.currentProxy) {
        await deleteProxy(this.currentProxy.id, this.logger);
        this.currentProxy = null;
      }

      // Launch new instance
      await this.launchBrowserInstance();

      this.searchCount = 0;
      logWithDedup(
        "success",
        "✅ Browser restarted successfully",
        chalk.green,
        this.logger
      );
    } catch (error) {
      this.logger?.error("Failed to restart browser", { error: error.message });
      throw error;
    }
  }

  /**
   * Switch proxy if auto proxy is enabled
   */
  async switchProxy() {
    if (!this.config.autoProxy) {
      return false;
    }

    try {
      this.logger?.info("Attempting to switch proxy");

      // Clean up old proxy
      if (this.currentProxy) {
        await deleteProxy(this.currentProxy.id, this.logger);
      }

      // Generate new proxy
      const newProxy = await generateProxy(this.logger);
      if (newProxy) {
        this.currentProxy = newProxy;
        this.config.proxyConfig = {
          type: newProxy.type,
          host: newProxy.host,
          port: newProxy.port,
          username: newProxy.username,
          password: newProxy.password,
        };

        logWithDedup(
          "success",
          `🌐 Proxy switched: ${newProxy.host}:${newProxy.port}`,
          chalk.green,
          this.logger
        );
        return true;
      } else {
        logWithDedup(
          "warning",
          "⚠️ Failed to generate new proxy",
          chalk.yellow,
          this.logger
        );
        return false;
      }
    } catch (error) {
      this.logger?.error("Failed to switch proxy", { error: error.message });
      return false;
    }
  }

  /**
   * Perform a single dork search with pagination support
   * @param {string} dork - The dork query
   * @param {number} maxResults - Maximum results to return
   * @param {string[]} engines - Array of search engines to use (e.g., ['google', 'bing', 'duckduckgo'])
   * @returns {Promise<Array>} Search results
   */
  async performSearch(dork, maxResults = 30, engines = ['google']) {
    try {
      this.logger?.info("Performing search", {
        dork: dork.substring(0, 50),
        maxResults,
        engines,
      });

      let allResults = [];
      
      // Initialize session if dashboard exists
      if (this.dashboard) {
        this.dashboard.startSession(engines.length);
        this.dashboard.setCurrentDork(dork);
      }

      for (const engine of engines) {
        try {
          this.logger?.info(`Searching with ${engine}...`);
          
          if (this.dashboard) {
            this.dashboard.addLog("info", `🔍 Searching with ${engine}...`);
            this.dashboard.setProcessingStatus(`Processing with ${engine}`);
          }

          const { page } = this.pageData;

          // Check if we need to restart browser
          if (this.searchCount >= this.restartThreshold) {
            await this.restartBrowser();
          }

          // Navigate to search engine
          const engineConfig = SEARCH_ENGINES[engine];
          if (!engineConfig) {
            this.logger?.warn(`Unsupported search engine: ${engine}`);
            if (this.dashboard) {
              this.dashboard.incrementProcessed();
              this.dashboard.incrementFailed();
            }
            continue;
          }

          // Navigate to search engine homepage
          this.logger?.info(`Navigating to ${engineConfig.baseUrl}`);
          await page.goto(engineConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
          await sleep(engineConfig.waitTime || 2000, `waiting for ${engine} to load`, this.logger);

          // Handle CAPTCHA and consent forms
          const captchaHandled = await handleCaptcha(
            page,
            this.config,
            this.logger,
            this.config.autoProxy ? async () => await this.switchProxy() : null,
            this.dashboard,
            this.pageData
          );
            
          if (!captchaHandled) {
            this.logger?.warn(`CAPTCHA handling failed for ${engine}, trying next engine`);
            continue;
          }

          // Update status to searching
          if (this.dashboard) {
            this.dashboard.setStatus("searching");
          }

          // Find and interact with search box using multiple selectors
          const searchBoxSelectors = {
            google: ['input[name="q"]', '#APjFqb', '.gLFyf'],
            bing: ['#sb_form_q', 'input[name="q"]', '#search_box'],
            duckduckgo: ['#search_form_input_homepage', '#search_form_input', 'input[name="q"]']
          }[engine];

          let searchBox = null;
          for (const selector of searchBoxSelectors) {
            try {
              await page.waitForSelector(selector, { timeout: 5000 }).catch(() => null);
              searchBox = await page.$(selector);
              if (searchBox) {
                this.logger?.info(`Found search box with selector: ${selector}`);
                break;
              }
            } catch (e) {
              continue;
            }
          }

          if (!searchBox) {
            this.logger?.warn(`Could not find search box for ${engine}`);
            continue;
          }

          // Handle consent forms for Bing
          if (engine === 'bing') {
            try {
              const consentSelectors = [
                '#bnp_btn_accept',
                '#consent-banner button',
                'button[id*="consent"]',
                'button:has-text("Accept")',
                'button:has-text("Agree")',
                '#bnp_container button'
              ];

              for (const selector of consentSelectors) {
                try {
                  await page.waitForSelector(selector, { timeout: 2000 }).catch(() => null);
                  const button = await page.$(selector);
                  if (button) {
                    await button.click();
                    this.logger?.info(`Clicked Bing consent button with selector: ${selector}`);
                    await sleep(1000, "after clicking Bing consent button", this.logger);
                    break;
                  }
                } catch (e) {
                  // Continue trying other selectors
                }
              }
            } catch (error) {
              this.logger?.warn('Error handling Bing consent:', error.message);
            }
          }

          // Handle DuckDuckGo specific setup
          if (engine === 'duckduckgo') {
            try {
              // Wait for page to be fully loaded
              await sleep(2000, "waiting for DuckDuckGo to fully load", this.logger);
              
              // Check for any cookie/privacy banners
              const ddgConsentSelectors = [
                'button[data-testid="privacy-banner-accept"]',
                '.privacy-banner button',
                '[data-cy="accept-all"]',
                'button:has-text("Accept")',
                'button:has-text("Got it")',
                'button:has-text("OK")'
              ];

              for (const selector of ddgConsentSelectors) {
                try {
                  await page.waitForSelector(selector, { timeout: 2000 }).catch(() => null);
                  const button = await page.$(selector);
                  if (button) {
                    await button.click();
                    this.logger?.info(`Clicked DuckDuckGo consent button with selector: ${selector}`);
                    await sleep(1000, "after clicking DuckDuckGo consent button", this.logger);
                    break;
                  }
                } catch (e) {
                  // Continue trying other selectors
                }
              }
            } catch (error) {
              this.logger?.warn('Error handling DuckDuckGo setup:', error.message);
            }
          }

          // Clear and fill search box
          await searchBox.click();
          await searchBox.focus();
          await page.keyboard.down(process.platform === "darwin" ? "Meta" : "Control");
          await page.keyboard.press("a");
          await page.keyboard.up(process.platform === "darwin" ? "Meta" : "Control");
          await page.keyboard.press("Delete");
          await sleep(500, "after clearing search box", this.logger);

          // Type query with delay
          await searchBox.type(dork, { delay: 100 });
          await sleep(500, "after typing query", this.logger);

          // Submit search
          await page.keyboard.press("Enter");
          
          // Wait for navigation with better error handling
          try {
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 });
          } catch (_navError) {
            this.logger?.warn(`Navigation timeout for ${engine}, continuing anyway...`);
            // Wait a bit more for the page to load
            await sleep(3000, `waiting for ${engine} results after navigation timeout`, this.logger);
          }

          // Wait for results with multiple selector attempts
          const resultsSelectors = {
            google: ['div.g', '#search div[data-hveid]', '#rso > div'],
            bing: ['li.b_algo', '#b_results > li', '.b_results .b_algo'],
            duckduckgo: ['article[data-testid="result"]', '.result', '.results .result']
          }[engine];

          let resultsFound = false;
          let workingSelector = '';
          for (const selector of resultsSelectors) {
            try {
              await page.waitForSelector(selector, { timeout: 10000 });
              this.logger?.info(`Found results with selector: ${selector}`);
              resultsFound = true;
              workingSelector = selector;
              break;
            } catch (e) {
              this.logger?.info(`Selector ${selector} not found, trying next...`);
              continue;
            }
          }

          if (!resultsFound) {
            this.logger?.warn('No results found with any selector');
            if (this.dashboard) {
              this.dashboard.incrementProcessed();
              this.dashboard.incrementFailed();
            }
            continue;
          }

          // Debug: Log page content
          this.logger?.info('Attempting to extract results...');
          const pageContent = await page.content();
          this.logger?.debug(`Page content length: ${pageContent.length}`);

          // Extract results using engine-specific selectors with debug info
          const results = await page.evaluate((config) => {
            console.log('Starting result extraction...');
            const containers = document.querySelectorAll(config.resultsSelector);
            console.log(`Found ${containers.length} result containers`);
            
            const results = [];
            const seenUrls = new Set();

            function extractGoogleUrl(href) {
              try {
                if (!href) return null;
                // For Google search results
                if (href.startsWith('/url?')) {
                  const url = new URL('https://www.google.com' + href);
                  const realUrl = url.searchParams.get('url');
                  return realUrl || null;
                }
                return href;
              } catch (e) {
                console.error('Error extracting URL:', e);
                return null;
              }
            }

            for (const container of containers) {
              try {
                console.log('Processing container:', container.outerHTML.substring(0, 100) + '...');
                
                const linkElement = container.querySelector(config.linkSelector);
                if (!linkElement) {
                  console.log('No link element found with selector:', config.linkSelector);
                  continue;
                }

                let url;
                if (config.name === 'Google') {
                  url = extractGoogleUrl(linkElement.getAttribute('href'));
                } else {
                  url = linkElement.href;
                }

                if (!url || seenUrls.has(url)) {
                  console.log('Invalid or duplicate URL:', url);
                  continue;
                }

                const titleElement = container.querySelector(config.titleSelector);
                const title = titleElement ? titleElement.textContent.trim() : '';
                console.log('Found title:', title);

                const descElement = container.querySelector(config.descriptionSelector);
                const description = descElement ? descElement.textContent.trim() : '';
                console.log('Found description:', description.substring(0, 50) + '...');

                if (url && (title || description)) {
                  seenUrls.add(url);
                  results.push({ url, title, description });
                  console.log('Added result:', { url, title: title.substring(0, 30) + '...' });
                }
              } catch (e) {
                console.error('Error extracting result:', e);
              }
            }

            console.log(`Extracted ${results.length} total results`);
            return results;
          }, engineConfig);

          this.logger?.info(`Extracted ${results.length} results from ${engine}`);

          // If no results found or for Google, try alternative extraction
          if (results.length === 0 || engine === 'google') {
            this.logger?.info(`${results.length === 0 ? 'No results extracted with primary selectors' : 'Using alternative extraction for Google'}, trying alternatives...`);
            
            // Try alternative extraction with more generic selectors
            const alternativeResults = await page.evaluate((workingSelector) => {
              console.log('Trying alternative extraction...');
              const results = [];
              const containers = document.querySelectorAll(workingSelector);
              const seenUrls = new Set();
              
              for (const container of containers) {
                try {
                  // Try to find any link in the container
                  const links = container.getElementsByTagName('a');
                  for (const link of links) {
                    let url = link.href;
                    
                    // For Google, extract real URL from redirect
                    if (url && url.includes('/url?')) {
                      try {
                        const urlObj = new URL(url);
                        const realUrl = urlObj.searchParams.get('url');
                        if (realUrl) url = realUrl;
                      } catch (e) {
                        // Keep original URL if parsing fails
                      }
                    }
                    
                    if (!url || !url.startsWith('http') || seenUrls.has(url)) continue;
                    
                    const title = link.textContent.trim();
                    const description = '';
                    
                    if (url && title) {
                      seenUrls.add(url);
                      results.push({ url, title, description });
                      console.log('Added alternative result:', { url, title: title.substring(0, 30) + '...' });
                    }
                  }
                } catch (e) {
                  console.error('Error in alternative extraction:', e);
                }
              }
              
              console.log(`Extracted ${results.length} alternative results`);
              return results;
            }, workingSelector);

            if (alternativeResults.length > 0) {
              this.logger?.info(`Found ${alternativeResults.length} results with alternative extraction`);
              // For Google, replace results; for others, add to existing
              if (engine === 'google') {
                results.length = 0; // Clear existing results
                results.push(...alternativeResults);
              } else {
                results.push(...alternativeResults);
              }
            }
          }

          // Log found URLs for this engine
          if (results.length > 0) {
            this.logger?.info(`URLs found in ${engine}:`, {
              engine,
              count: results.length,
              urls: results.slice(0, 5).map(r => r.url) // Log first 5 URLs
            });
            
            // Log all URLs in debug mode
            results.forEach((result, index) => {
              this.logger?.debug(`${engine} URL ${index + 1}: ${result.url}`);
            });
          }

          // Apply dork-based filtering if enabled
          let filteredResults = results;
          if (this.config.dorkFiltering && results.length > 0) {
            filteredResults = this.filterResultsByDork(results, dork);
            this.logger?.info(`Filtered to ${filteredResults.length} results matching dork pattern`);
          }

          // Add engine identifier to results
          filteredResults = filteredResults.map(result => ({
            ...result,
            engine: engine
          }));

          allResults = [...allResults, ...filteredResults];

          // Update dashboard statistics
          if (this.dashboard) {
            this.dashboard.incrementProcessed();
            if (filteredResults.length > 0) {
              this.dashboard.incrementSuccessful();
              this.dashboard.addToTotalResults(filteredResults.length);
            } else {
              this.dashboard.incrementFailed();
            }
          }

          // Add delay between engines
          if (engines.indexOf(engine) < engines.length - 1) {
            await sleep(3000 + Math.random() * 2000, "between engines", this.logger);
          }
        } catch (error) {
          this.logger?.error(`Search failed for engine ${engine}`, {
            error: error.message,
          });
          if (this.dashboard) {
            this.dashboard.incrementProcessed();
            this.dashboard.incrementFailed();
          }
        }
      }

      this.searchCount++;
      
      // End session and get summary
      if (this.dashboard) {
        this.dashboard.endSession();
        const summary = this.dashboard.getSessionSummary();
        this.dashboard.addLog("info", `📊 Search Summary: ${JSON.stringify(summary)}`);
      }

      return allResults;
    } catch (error) {
      this.logger?.error("Search failed", {
        dork: dork.substring(0, 50),
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Extract results for a specific search engine
   * @param {Object} page - Puppeteer page
   * @param {number} maxResults - Maximum results to extract
   * @param {string} engine - Search engine name
   * @returns {Promise<Array>} Extracted results
   */
  async extractResultsForEngine(page, maxResults, engine) {
    const engineConfig = SEARCH_ENGINES[engine];
    if (!engineConfig) return [];

    await sleep(2000, "waiting for results to load", this.logger);

    return await page.evaluate((config, max) => {
      const results = [];
      const seenUrls = new Set();

      // Find all result containers
      const containers = document.querySelectorAll(config.resultsSelector);
      
      for (const container of containers) {
        if (results.length >= max) break;

        try {
          // Find link and extract URL
          const linkElement = container.querySelector(config.linkSelector);
          if (!linkElement) continue;

          const url = linkElement.href;
          if (!url || seenUrls.has(url)) continue;

          // Extract title
          const titleElement = container.querySelector(config.titleSelector);
          const title = titleElement ? titleElement.textContent.trim() : '';

          // Extract description
          const descElement = container.querySelector(config.descriptionSelector);
          const description = descElement ? descElement.textContent.trim() : '';

          if (url && (title || description)) {
            seenUrls.add(url);
            results.push({ url, title, description });
          }
        } catch (e) {
          console.error('Error extracting result:', e);
        }
      }

      return results;
    }, engineConfig, maxResults);
  }

  /**
   * Handle pagination for a specific search engine
   * @param {Object} page - Puppeteer page
   * @param {string} engine - Search engine name
   * @param {number} maxResults - Maximum results to extract
   * @returns {Promise<Array>} Results from next page
   */
  async handlePaginationForEngine(page, engine, maxResults) {
    const nextPageSelectors = {
      google: 'a[aria-label="Next page"]',
      bing: 'a.sb_pagN',
      duckduckgo: 'a.next'
    };

    const selector = nextPageSelectors[engine];
    if (!selector) return [];

    try {
      const nextButton = await page.$(selector);
      if (!nextButton) return [];

      await nextButton.click();
      await page.waitForNavigation({ waitUntil: 'networkidle0' });
      await sleep(2000, "after pagination", this.logger);

      return await this.extractResultsForEngine(page, maxResults, engine);
    } catch (error) {
      this.logger?.warn(`Pagination failed for ${engine}:`, error.message);
      return [];
    }
  }

  /**
   * Extract search results from Google results page
   * @param {Object} page - Puppeteer page
   * @param {number} maxResults - Maximum results to extract
   * @returns {Promise<Array>} Extracted results
   */
  async extractResults(page, maxResults = 30) {
    try {
      this.logger?.debug("Extracting search results", { maxResults });

      // Wait for results to load
      await sleep(2000, "waiting for results to load", this.logger);

      // Extract results using multiple strategies
      const results = await page.evaluate((max) => {
        const results = [];
        const seenUrls = new Set();
        const seenTitles = new Set(); // Also track titles to prevent exact duplicates

        // Helper function to decode URL from Google redirect - handles multiple patterns
        function extractRealUrl(href) {
          if (!href) {
            console.log(`❌ No href provided`);
            return null;
          }

          console.log(
            `🔍 Starting URL extraction from: ${href.substring(0, 200)}...`
          );

          // Handle Google redirect URLs with different patterns
          if (href.includes("/url?")) {
            try {
              // Step 1: Decode HTML entities (&amp; -> &, &lt; -> <, etc.)
              const htmlDecoded = href
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");

              console.log(
                `🔄 HTML decoded: ${htmlDecoded.substring(0, 200)}...`
              );

              // Step 2: Extract the query string part after /url?
              const urlPart = htmlDecoded.split("/url?")[1];

              if (!urlPart) {
                console.log(`❌ No URL part found after /url?`);
                return null;
              }

              console.log(`📋 URL query part: ${urlPart.substring(0, 300)}...`);

              // Step 3: Parse URL parameters
              const urlParams = new URLSearchParams(urlPart);

              // Step 4: Log ALL parameters for debugging
              const allParams = {};
              for (const [key, value] of urlParams) {
                allParams[key] =
                  value.length > 100 ? value.substring(0, 100) + "..." : value;
              }
              console.log(`📋 ALL URL parameters found:`, allParams);

              // Step 5: Extract the real URL - try multiple parameter names
              let realUrl = null;
              const paramNames = ["url", "q", "u", "rurl"];

              for (const paramName of paramNames) {
                const paramValue = urlParams.get(paramName);
                if (paramValue) {
                  realUrl = paramValue;
                  console.log(
                    `✅ Found URL in parameter '${paramName}': ${realUrl.substring(
                      0,
                      150
                    )}...`
                  );
                  break;
                }
              }

              if (!realUrl) {
                console.log(
                  `❌ No URL found in any of these parameters: ${paramNames.join(
                    ", "
                  )}`
                );
                return null;
              }

              // Step 6: URL decode the extracted URL (handles %3F -> ?, %3D -> =, etc.)
              let decoded;
              try {
                decoded = decodeURIComponent(realUrl);
                console.log(`🔄 First decode: ${decoded.substring(0, 150)}...`);

                // Check if still encoded and decode again if needed
                if (decoded.match(/%[0-9A-Fa-f]{2}/)) {
                  console.log(`🔄 Double-encoded detected, decoding again...`);
                  decoded = decodeURIComponent(decoded);
                  console.log(
                    `🔄 Second decode: ${decoded.substring(0, 150)}...`
                  );
                }
              } catch (decodeError) {
                console.log(
                  `❌ Decode error: ${decodeError.message}, using raw value`
                );
                decoded = realUrl;
              }

              // Step 7: Validate the final URL
              console.log(`🎯 Final extracted URL: ${decoded}`);
              console.log(`📊 URL analysis:`, {
                startsWithHttp:
                  decoded.startsWith("http://") ||
                  decoded.startsWith("https://"),
                hasParameters: decoded.includes("?"),
                parameterCount: (decoded.match(/[?&]/g) || []).length,
                isGoogleInternal: decoded.includes("google.com"),
                length: decoded.length,
              });

              // Step 8: Skip Google internal URLs
              if (
                decoded.includes("google.com") ||
                decoded.includes("gstatic.com") ||
                decoded.includes("googleusercontent.com") ||
                decoded.includes("youtube.com") ||
                decoded.includes("accounts.google.com") ||
                decoded.includes("maps.google.com") ||
                decoded.includes("translate.google.com") ||
                decoded.includes("policies.google.com") ||
                decoded.includes("support.google.com") ||
                decoded.includes("/policies/") ||
                decoded.includes("/terms") ||
                decoded.includes("/privacy")
              ) {
                console.log(
                  `🚫 Skipping Google internal URL: ${decoded.substring(
                    0,
                    80
                  )}...`
                );
                return null;
              }

              // Step 9: Validate URL format
              if (
                decoded.startsWith("http://") ||
                decoded.startsWith("https://")
              ) {
                console.log(
                  `✅ SUCCESS! Valid URL extracted with ALL parameters: ${decoded}`
                );
                return decoded;
              } else {
                console.log(
                  `❌ Invalid URL format (missing http/https): ${decoded.substring(
                    0,
                    80
                  )}...`
                );
                return null;
              }
            } catch (error) {
              console.log(
                `❌ Error parsing Google redirect URL: ${error.message}`
              );
              return null;
            }
          } else {
            console.log(
              `⚠️ URL does not contain /url? pattern: ${href.substring(
                0,
                80
              )}...`
            );
            return null;
          }
        }

        // Helper function to clean text
        function cleanText(text) {
          return text ? text.trim().replace(/\s+/g, " ") : "";
        }

        // Strategy 1: Google result links (multiple patterns)
        console.log("Trying Google result link extraction...");

        // Look for Google result links with different URL patterns - be more inclusive
        const resultLinks = Array.from(
          document.querySelectorAll('a[href*="/url?"]')
        );

        console.log(
          `Found ${resultLinks.length} result links with /url? pattern`
        );

        for (const link of resultLinks) {
          if (results.length >= max) break;

          // Debug: Log HTML structure of found link
          console.log(`🔍 Found link HTML:`, {
            outerHTML: link.outerHTML.substring(0, 200) + "...",
            href: link.href.substring(0, 150) + "...",
            classes: link.className,
            textContent: link.textContent.substring(0, 100) + "...",
            hasDataVed: link.hasAttribute("data-ved"),
            parentClasses: link.parentElement?.className || "no parent",
          });

          const url = extractRealUrl(link.href);
          if (!url) {
            console.log(
              `❌ Failed to extract URL from:`,
              link.href.substring(0, 100) + "..."
            );
            continue;
          }

          // Debug: Log successful URL extraction
          console.log(`✅ Successfully extracted URL:`, {
            originalHref: link.href.substring(0, 100) + "...",
            extractedUrl: url,
            linkText: link.textContent.substring(0, 50) + "...",
          });

          // Simple duplicate prevention - only check exact URL matches
          if (seenUrls.has(url)) {
            console.log(
              `🔄 Skipping duplicate URL: ${url.substring(0, 50)}...`
            );
            continue;
          }

          let title = "";
          let description = "";

          // Modern title extraction - look for various title classes
          const titleSelectors = [
            "h3.zBAuLc",
            "h3.l97dzf",
            "h3.LC20lb", // Common modern title classes
            ".zBAuLc",
            ".l97dzf",
            ".LC20lb", // Without h3 tag
            "h3", // Fallback to any h3
            ".ilUpNd",
            ".UFvD1",
            ".aSRlid",
            ".IwSnJ", // Additional modern classes
          ];

          // Try to find title in link or its container
          const container =
            link.closest(
              "div[data-ved], div.g, div.Gx5Zad, div.kvH3mc, div.MjjYud"
            ) || link;

          for (const selector of titleSelectors) {
            const titleElement =
              container.querySelector(selector) || link.querySelector(selector);
            if (titleElement && titleElement.textContent.trim()) {
              title = cleanText(titleElement.textContent);
              break;
            }
          }

          // If no title found in selectors, try link text or aria-label
          if (!title) {
            title =
              cleanText(link.textContent) ||
              cleanText(link.getAttribute("aria-label")) ||
              "No title";
          }

          // Modern description extraction
          const descSelectors = [
            ".VwiC3b",
            ".s",
            ".st", // Classic description classes
            ".sCuL3",
            ".BamJPe",
            ".XR4uSe", // Modern description classes
            ".lEBKkf",
            ".hgKElc",
            ".YUQM0", // Additional modern classes
            'span[style*="color"]',
            'div[style*="color"]',
            ".f",
            ".fG8Fp",
            ".aCOpRe",
            ".IsZvec",
            ".ygGdYc",
            ".lyLwlc", // More modern classes
          ];

          for (const selector of descSelectors) {
            const descElement = container.querySelector(selector);
            if (descElement && descElement.textContent.trim()) {
              description = cleanText(descElement.textContent);
              break;
            }
          }

          if (
            title &&
            title !== "No title" &&
            title.length > 0 &&
            !seenTitles.has(title)
          ) {
            seenUrls.add(url);
            seenTitles.add(title);
            results.push({
              title: title,
              url: url,
              description: description,
            });
            console.log(`Extracted result: ${title} -> ${url}`);
          }
        }

        // Strategy 2: Alternative URL patterns - look for other redirect patterns
        if (results.length === 0) {
          console.log(
            "No results found with /url?q=, trying other URL patterns..."
          );

          // Try other Google redirect patterns
          const alternativeLinks = Array.from(
            document.querySelectorAll(
              'a[href*="/url?"][href*="url="], a[href*="/url?"][data-ved]'
            )
          );

          console.log(
            `Found ${alternativeLinks.length} alternative pattern links`
          );

          for (const link of alternativeLinks) {
            if (results.length >= max) break;

            // Debug: Log HTML structure of alternative link
            console.log(`🔍 Alternative link HTML:`, {
              outerHTML: link.outerHTML.substring(0, 200) + "...",
              href: link.href.substring(0, 150) + "...",
              classes: link.className,
              textContent: link.textContent.substring(0, 100) + "...",
              hasDataVed: link.hasAttribute("data-ved"),
              parentClasses: link.parentElement?.className || "no parent",
            });

            const url = extractRealUrl(link.href);
            if (!url) {
              console.log(
                `❌ Failed to extract URL from alternative link:`,
                link.href.substring(0, 100) + "..."
              );
              continue;
            }

            // Debug: Log successful URL extraction from alternative link
            console.log(
              `✅ Successfully extracted URL from alternative link:`,
              {
                originalHref: link.href.substring(0, 100) + "...",
                extractedUrl: url,
                linkText: link.textContent.substring(0, 50) + "...",
              }
            );

            // Simple duplicate prevention - only check exact URL matches
            if (seenUrls.has(url)) {
              console.log(
                `🔄 Skipping duplicate URL from alternative: ${url.substring(
                  0,
                  50
                )}...`
              );
              continue;
            }

            // Try to find title from h3 elements only
            let title = "";
            const h3Element =
              link.querySelector("h3") ||
              link.closest("div").querySelector("h3") ||
              link.parentElement?.querySelector("h3");

            if (h3Element) {
              title = cleanText(h3Element.textContent);
            } else {
              title = "No title";
            }

            if (title && title !== "No title" && !seenTitles.has(title)) {
              seenUrls.add(url);
              seenTitles.add(title);
              results.push({
                title: title,
                url: url,
                description: "",
              });
              console.log(`Extracted alternative result: ${title} -> ${url}`);
            }
          }
        }

        // Strategy 3: Direct href links (without /url? redirect)
        if (results.length === 0) {
          console.log("Trying direct href extraction...");

          // Look for links that go directly to external sites (not Google redirects)
          const directLinks = Array.from(
            document.querySelectorAll(
              'a[href^="http"]:not([href*="google.com"]):not([href*="youtube.com"])'
            )
          );

          console.log(`Found ${directLinks.length} direct external links`);

          for (const link of directLinks) {
            if (results.length >= max) break;

            const url = link.href;

            // Skip if URL looks like it's still a Google internal URL
            if (
              url.includes("google.com") ||
              url.includes("gstatic.com") ||
              url.includes("googleusercontent.com") ||
              url.includes("youtube.com") ||
              url.includes("accounts.google.com") ||
              url.includes("maps.google.com") ||
              url.includes("translate.google.com") ||
              url.includes("policies.google.com") ||
              url.includes("support.google.com")
            ) {
              continue;
            }

            // Skip duplicates
            if (seenUrls.has(url)) {
              continue;
            }

            console.log(`🔍 Direct link found:`, {
              href: url.substring(0, 100) + "...",
              textContent: link.textContent.substring(0, 50) + "...",
              hasDataVed: link.hasAttribute("data-ved"),
            });

            let title = "";
            let description = "";

            // Try to find title in link or its container
            const container =
              link.closest(
                "div[data-ved], div.g, div.Gx5Zad, div.kvH3mc, div.MjjYud"
              ) || link;

            const titleSelectors = [
              "h3.LC20lb",
              "h3.zBAuLc",
              "h3.l97dzf",
              "h3",
              ".LC20lb",
              ".zBAuLc",
              ".l97dzf",
            ];
            for (const selector of titleSelectors) {
              const titleElement =
                container.querySelector(selector) ||
                link.querySelector(selector);
              if (titleElement && titleElement.textContent.trim()) {
                title = cleanText(titleElement.textContent);
                break;
              }
            }

            if (!title) {
              title =
                cleanText(link.textContent) ||
                cleanText(link.getAttribute("aria-label")) ||
                "No title";
            }

            if (
              title &&
              title !== "No title" &&
              title.length > 0 &&
              !seenTitles.has(title)
            ) {
              seenUrls.add(url);
              seenTitles.add(title);
              results.push({
                title: title,
                url: url,
                description: description,
              });
              console.log(`Extracted direct result: ${title} -> ${url}`);
            }
          }
        }

        // Strategy 4: Container-based extraction (for all /url? links)
        if (results.length === 0) {
          console.log("Trying container-based extraction for /url? links...");

          // Only look for containers that have /url? links
          const containers = Array.from(
            document.querySelectorAll("div.g, div[data-ved], div.MjjYud")
          );

          for (const container of containers) {
            if (results.length >= max) break;

            // Only get /url? links from this container
            const linkElement = container.querySelector('a[href*="/url?"]');
            if (!linkElement) continue;

            // Debug: Log HTML structure of container link
            console.log(`🔍 Container link HTML:`, {
              containerHTML: container.outerHTML.substring(0, 300) + "...",
              linkHTML: linkElement.outerHTML.substring(0, 200) + "...",
              href: linkElement.href.substring(0, 150) + "...",
              classes: linkElement.className,
              textContent: linkElement.textContent.substring(0, 100) + "...",
              hasDataVed: linkElement.hasAttribute("data-ved"),
              containerClasses: container.className,
            });

            const url = extractRealUrl(linkElement.href);
            if (!url) {
              console.log(
                `❌ Failed to extract URL from container link:`,
                linkElement.href.substring(0, 100) + "..."
              );
              continue;
            }

            // Debug: Log successful URL extraction from container
            console.log(`✅ Successfully extracted URL from container:`, {
              originalHref: linkElement.href.substring(0, 100) + "...",
              extractedUrl: url,
              linkText: linkElement.textContent.substring(0, 50) + "...",
            });

            // Simple duplicate prevention - only check exact URL matches
            if (seenUrls.has(url)) {
              console.log(
                `🔄 Skipping duplicate URL from container: ${url.substring(
                  0,
                  50
                )}...`
              );
              continue;
            }

            // URL filtering is now handled in extractRealUrl function

            // Extract title from h3 only
            let title = "";
            const h3Element = container.querySelector("h3");
            if (h3Element) {
              title = cleanText(h3Element.textContent);
            } else {
              title = "No title";
            }

            if (title && title !== "No title" && !seenTitles.has(title)) {
              seenUrls.add(url);
              seenTitles.add(title);
              results.push({
                title: title,
                url: url,
                description: "",
              });
              console.log(`Extracted container result: ${title} -> ${url}`);
            }
          }
        }

        // Final debugging
        console.log(`Final results count: ${results.length}`);
        if (results.length > 0) {
          console.log("Sample result:", results[0]);
        } else {
          console.log("No results extracted - analyzing page structure...");

          // Debug: Check what elements are available
          const debugInfo = {
            links: {
              "with /url?q=":
                document.querySelectorAll('a[href*="/url?q="]').length,
              "with /url? (any)":
                document.querySelectorAll('a[href*="/url?"]').length,
              "with data-ved": document.querySelectorAll(
                'a[href*="/url?"][data-ved]'
              ).length,
              "total links": document.querySelectorAll("a[href]").length,
            },
            containers: {
              "div.g": document.querySelectorAll("div.g").length,
              "div[data-ved]":
                document.querySelectorAll("div[data-ved]").length,
              "div.MjjYud": document.querySelectorAll("div.MjjYud").length,
              "div.kvH3mc": document.querySelectorAll("div.kvH3mc").length,
            },
            titles: {
              "h3.zBAuLc": document.querySelectorAll("h3.zBAuLc").length,
              "h3.l97dzf": document.querySelectorAll("h3.l97dzf").length,
              "h3.LC20lb": document.querySelectorAll("h3.LC20lb").length,
              "h3 (any)": document.querySelectorAll("h3").length,
            },
            pageIndicators: {
              hasSearchResults:
                document.querySelector("#search, #rso, #res") !== null,
              hasCaptcha:
                document.querySelector('[src*="captcha"], .recaptcha') !== null,
              hasConsentPage: document.body.textContent.includes(
                "Before you continue to Google"
              ),
            },
          };
          console.log("Debug info:", debugInfo);

          // Sample some actual HTML structure
          const sampleLinks = document.querySelectorAll('a[href*="/url?"]');
          if (sampleLinks.length > 0) {
            console.log(
              `Sampling first 3 of ${sampleLinks.length} /url? links:`
            );
            for (let i = 0; i < Math.min(3, sampleLinks.length); i++) {
              const link = sampleLinks[i];
              console.log(`Link ${i + 1}:`, {
                href: link.href.substring(0, 100) + "...",
                classes: link.className,
                hasDataVed: link.hasAttribute("data-ved"),
                textContent: link.textContent.substring(0, 50) + "...",
                parentTag: link.parentElement?.tagName,
                parentClasses: link.parentElement?.className,
              });
            }
          } else {
            console.log("No /url? links found at all");
            // Check for any Google result patterns
            const anyResultLinks = document.querySelectorAll(
              'a[href*="google.com"], a[href^="/search"], a[href^="/url"]'
            );
            console.log(
              `Found ${anyResultLinks.length} potential Google result links`
            );
          }
        }

        return results;
      }, maxResults);

      this.logger?.debug("Results extracted", { count: results.length });

      // Log every extracted URL
      if (results.length > 0) {
        this.logger?.info(
          `🔍 URL EXTRACTION COMPLETE: ${results.length} URLs extracted from search results`
        );
        results.forEach((result, index) => {
          this.logger?.info(
            `📃 URL EXTRACTED [${index + 1}/${results.length}]: ${result.url}`,
            {
              title: result.title || "No title",
              description: result.description
                ? result.description.substring(0, 100) + "..."
                : "No description",
              source: "Google search extraction",
            }
          );
        });
      } else {
        // If no results found, log page content for debugging
        this.logger?.debug("No results found, checking page content...");
        const hasLinks = await page.evaluate(() => {
          const allLinks = document.querySelectorAll("a[href]");
          const redirectLinks = document.querySelectorAll('a[href*="/url?q="]');
          const modernLinks = document.querySelectorAll(
            'a[href*="/url?q="][data-ved]'
          );

          return {
            totalLinks: allLinks.length,
            redirectLinks: redirectLinks.length,
            modernLinks: modernLinks.length,
            pageText: document.body.textContent.slice(0, 200) + "...",
            currentUrl: window.location.href,
            hasSearchResults:
              document.querySelector("#search, #rso, #res") !== null,
          };
        });
        this.logger?.debug("Page analysis:", hasLinks);
      }

      return results;
    } catch (error) {
      // Check if error is due to detached frame
      if (
        error.message.includes("detached") ||
        error.message.includes("Target closed") ||
        error.message.includes("Session closed")
      ) {
        // Page/frame was closed or navigated away - this is expected sometimes
        this.logger?.debug("Page context lost during extraction");
        return [];
      }

      this.logger?.error("Failed to extract results", { error: error.message });
      return [];
    }
  }

  /**
   * Check if pagination is available on the current page
   * @param {Object} page - Puppeteer page
   * @returns {Promise<boolean>} True if next page is available
   */
  async checkPaginationAvailable(page) {
    try {
      const paginationInfo = await page.evaluate(() => {
        // Get current page start parameter
        const currentStart =
          new URLSearchParams(window.location.search).get("start") || "0";
        const currentStartNum = parseInt(currentStart);

        // Strategy 1: Look for text-based "Next" indicators (most reliable)
        const allLinks = Array.from(document.querySelectorAll("a[href]"));
        const nextTextPatterns = [
          /next\s*[>›→]/i,
          /[>›→]\s*next/i,
          /^next$/i,
          /^[>›→]$/,
          /dalej/i, // Polish
          /następn/i, // Polish "next"
          /suivant/i, // French
          /siguiente/i, // Spanish
          /weiter/i, // German
          /下一页/i, // Chinese
          /次へ/i, // Japanese
          /다음/i, // Korean
        ];

        for (const link of allLinks) {
          const linkText = link.textContent.trim();
          const linkHref = link.href;

          // Check if link text matches next patterns and has search URL
          if (linkHref.includes("/search") && linkHref.includes("start=")) {
            for (const pattern of nextTextPatterns) {
              if (pattern.test(linkText)) {
                const linkUrl = new URL(linkHref);
                const linkStart = parseInt(
                  linkUrl.searchParams.get("start") || "0"
                );

                // Ensure this link goes to a page after current page
                if (linkStart > currentStartNum) {
                  return {
                    hasNext: true,
                    nextUrl: linkHref,
                    strategy: "text_pattern",
                    reason: `Found Next button by text pattern: "${linkText}" (${linkStart} > ${currentStartNum})`,
                  };
                }
              }
            }
          }
        }

        // Strategy 2: Look for links with higher start parameters (URL-based detection)
        let bestNextLink = null;
        let lowestNextStart = Infinity;

        for (const link of allLinks) {
          if (link.href.includes("/search") && link.href.includes("start=")) {
            try {
              const linkUrl = new URL(link.href);
              const linkStart = parseInt(
                linkUrl.searchParams.get("start") || "0"
              );

              // Find the next sequential page (smallest start value greater than current)
              if (linkStart > currentStartNum && linkStart < lowestNextStart) {
                lowestNextStart = linkStart;
                bestNextLink = link;
              }
            } catch (e) {
              // Skip invalid URLs
            }
          }
        }

        if (bestNextLink) {
          return {
            hasNext: true,
            nextUrl: bestNextLink.href,
            strategy: "url_analysis",
            reason: `Found next page by URL analysis: start=${lowestNextStart} > ${currentStartNum}`,
          };
        }

        // Strategy 3: Look for positioned next links (bottom of page detection)
        const bottomLinks = allLinks.filter((link) => {
          const rect = link.getBoundingClientRect();
          const isBottomHalf = rect.top > window.innerHeight * 0.6;
          const hasSearchUrl = link.href.includes("/search");
          const hasStartParam = link.href.includes("start=");
          return isBottomHalf && hasSearchUrl && hasStartParam;
        });

        for (const link of bottomLinks) {
          try {
            const linkUrl = new URL(link.href);
            const linkStart = parseInt(
              linkUrl.searchParams.get("start") || "0"
            );

            if (linkStart > currentStartNum) {
              // Additional check: verify it's likely a pagination link
              const linkText = link.textContent.toLowerCase().trim();
              const isPaginationLike =
                linkText.length < 20 && // Short text
                (linkText.includes(">") ||
                  linkText.includes("→") ||
                  linkText.includes("›") ||
                  /^(next|\d+)$/i.test(linkText) ||
                  linkText === "");

              if (isPaginationLike) {
                return {
                  hasNext: true,
                  nextUrl: link.href,
                  strategy: "position_based",
                  reason: `Found pagination link at page bottom: "${linkText}" (${linkStart} > ${currentStartNum})`,
                };
              }
            }
          } catch (e) {
            // Skip invalid URLs
          }
        }

        // Strategy 4: Look for links that increment by typical pagination amounts (10, 20, etc.)
        const typicalIncrements = [10, 20, 25, 50, 100];
        for (const increment of typicalIncrements) {
          const expectedNext = currentStartNum + increment;

          for (const link of allLinks) {
            if (link.href.includes(`start=${expectedNext}`)) {
              return {
                hasNext: true,
                nextUrl: link.href,
                strategy: "increment_detection",
                reason: `Found next page by increment detection: ${expectedNext} (${currentStartNum} + ${increment})`,
              };
            }
          }
        }

        // Strategy 5: Fallback - try attribute-based detection without relying on specific classes
        const possibleNextSelectors = [
          'a[id*="next"]',
          'a[aria-label*="Next"]',
          'a[aria-label*="next"]',
          'a[title*="Next"]',
          'a[title*="next"]',
        ];

        for (const selector of possibleNextSelectors) {
          const element = document.querySelector(selector);
          if (element && element.href && element.href.includes("/search")) {
            try {
              const linkUrl = new URL(element.href);
              const linkStart = parseInt(
                linkUrl.searchParams.get("start") || "0"
              );

              if (linkStart > currentStartNum) {
                return {
                  hasNext: true,
                  nextUrl: element.href,
                  strategy: "attribute_based",
                  reason: `Found next button by attribute: ${selector}`,
                };
              }
            } catch (e) {
              // Skip invalid URLs
            }
          }
        }

        return {
          hasNext: false,
          reason: "No pagination method found",
          currentStart: currentStartNum,
          totalLinksChecked: allLinks.length,
          searchLinksFound: allLinks.filter((l) => l.href.includes("/search"))
            .length,
        };
      });

      this.logger?.debug("Pagination check:", paginationInfo);
      return paginationInfo.hasNext;
    } catch (error) {
      this.logger?.debug("Error checking pagination:", error.message);
      return false;
    }
  }

  /**
   * Navigate to the next page using pagination
   * @param {Object} page - Puppeteer page
   * @returns {Promise<boolean>} True if navigation was successful
   */
  async navigateToNextPage(page) {
    try {
      this.logger?.debug(
        "Attempting to navigate to next page using multiple strategies"
      );

      // Get the next page information first using the same robust detection as checkPaginationAvailable
      const paginationInfo = await page.evaluate(() => {
        // Get current page start parameter
        const currentStart =
          new URLSearchParams(window.location.search).get("start") || "0";
        const currentStartNum = parseInt(currentStart);

        // Strategy 1: Look for text-based "Next" indicators (most reliable)
        const allLinks = Array.from(document.querySelectorAll("a[href]"));
        const nextTextPatterns = [
          /next\s*[>›→]/i,
          /[>›→]\s*next/i,
          /^next$/i,
          /^[>›→]$/,
          /dalej/i, // Polish
          /następn/i, // Polish "next"
          /suivant/i, // French
          /siguiente/i, // Spanish
          /weiter/i, // German
          /下一页/i, // Chinese
          /次へ/i, // Japanese
          /다음/i, // Korean
        ];

        for (const link of allLinks) {
          const linkText = link.textContent.trim();
          const linkHref = link.href;

          // Check if link text matches next patterns and has search URL
          if (linkHref.includes("/search") && linkHref.includes("start=")) {
            for (const pattern of nextTextPatterns) {
              if (pattern.test(linkText)) {
                const linkUrl = new URL(linkHref);
                const linkStart = parseInt(
                  linkUrl.searchParams.get("start") || "0"
                );

                // Ensure this link goes to a page after current page
                if (linkStart > currentStartNum) {
                  return {
                    element: link,
                    url: linkHref,
                    strategy: "text_pattern",
                    text: linkText,
                  };
                }
              }
            }
          }
        }

        // Strategy 2: Look for the best next link by URL analysis
        let bestNextLink = null;
        let lowestNextStart = Infinity;

        for (const link of allLinks) {
          if (link.href.includes("/search") && link.href.includes("start=")) {
            try {
              const linkUrl = new URL(link.href);
              const linkStart = parseInt(
                linkUrl.searchParams.get("start") || "0"
              );

              // Find the next sequential page (smallest start value greater than current)
              if (linkStart > currentStartNum && linkStart < lowestNextStart) {
                lowestNextStart = linkStart;
                bestNextLink = link;
              }
            } catch (e) {
              // Skip invalid URLs
            }
          }
        }

        if (bestNextLink) {
          return {
            element: bestNextLink,
            url: bestNextLink.href,
            strategy: "url_analysis",
          };
        }

        // Strategy 3: Position-based detection (bottom of page)
        const bottomLinks = allLinks.filter((link) => {
          const rect = link.getBoundingClientRect();
          const isBottomHalf = rect.top > window.innerHeight * 0.6;
          const hasSearchUrl = link.href.includes("/search");
          const hasStartParam = link.href.includes("start=");
          return isBottomHalf && hasSearchUrl && hasStartParam;
        });

        for (const link of bottomLinks) {
          try {
            const linkUrl = new URL(link.href);
            const linkStart = parseInt(
              linkUrl.searchParams.get("start") || "0"
            );

            if (linkStart > currentStartNum) {
              const linkText = link.textContent.toLowerCase().trim();
              const isPaginationLike =
                linkText.length < 20 && // Short text
                (linkText.includes(">") ||
                  linkText.includes("→") ||
                  linkText.includes("›") ||
                  /^(next|\d+)$/i.test(linkText) ||
                  linkText === "");

              if (isPaginationLike) {
                return {
                  element: link,
                  url: link.href,
                  strategy: "position_based",
                  text: linkText,
                };
              }
            }
          } catch (e) {
            // Skip invalid URLs
          }
        }

        // Strategy 4: Attribute-based detection
        const possibleNextSelectors = [
          'a[id*="next"]',
          'a[aria-label*="Next"]',
          'a[aria-label*="next"]',
          'a[title*="Next"]',
          'a[title*="next"]',
        ];

        for (const selector of possibleNextSelectors) {
          const element = document.querySelector(selector);
          if (element && element.href && element.href.includes("/search")) {
            try {
              const linkUrl = new URL(element.href);
              const linkStart = parseInt(
                linkUrl.searchParams.get("start") || "0"
              );

              if (linkStart > currentStartNum) {
                return {
                  element: element,
                  url: element.href,
                  strategy: "attribute_based",
                };
              }
            } catch (e) {
              // Skip invalid URLs
            }
          }
        }

        return null;
      });

      if (!paginationInfo) {
        this.logger?.warn("No pagination method available for navigation");
        return false;
      }

      this.logger?.debug(
        `Using pagination strategy: ${paginationInfo.strategy}`
      );

      // Strategy 1: Try clicking the element first (more human-like)
      let navigationSuccess = false;

      try {
        const clickSuccess = await page.evaluate((paginationData) => {
          const { strategy, url } = paginationData;

          // Find the target element using the same logic as detection
          let targetElement = null;

          if (strategy === "text_pattern") {
            // Find by text pattern and URL match
            const allLinks = Array.from(document.querySelectorAll("a[href]"));
            const nextTextPatterns = [
              /next\s*[>›→]/i,
              /[>›→]\s*next/i,
              /^next$/i,
              /^[>›→]$/,
              /dalej/i,
              /następn/i,
              /suivant/i,
              /siguiente/i,
              /weiter/i,
              /下一页/i,
              /次へ/i,
              /다음/i,
            ];

            for (const link of allLinks) {
              if (link.href === url) {
                const linkText = link.textContent.trim();
                for (const pattern of nextTextPatterns) {
                  if (pattern.test(linkText)) {
                    targetElement = link;
                    break;
                  }
                }
                if (targetElement) break;
              }
            }
          } else {
            // For all other strategies, find by URL match
            const allLinks = Array.from(document.querySelectorAll("a[href]"));
            targetElement = allLinks.find((link) => link.href === url);
          }

          if (targetElement && !targetElement.hasAttribute("disabled")) {
            // Scroll element into view
            targetElement.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });

            // Add small delay for scrolling
            setTimeout(() => {
              // Simulate human-like click
              const rect = targetElement.getBoundingClientRect();
              const event = new MouseEvent("click", {
                view: window,
                bubbles: true,
                cancelable: true,
                clientX:
                  rect.left + rect.width / 2 + (Math.random() - 0.5) * 10,
                clientY:
                  rect.top + rect.height / 2 + (Math.random() - 0.5) * 10,
              });

              targetElement.dispatchEvent(event);
            }, 500);

            return true;
          }

          return false;
        }, paginationInfo);

        if (clickSuccess) {
          this.logger?.debug(
            `${paginationInfo.strategy} element clicked, waiting for navigation`
          );

          // Wait for navigation with longer timeout for slower connections
          await page.waitForNavigation({
            waitUntil: "networkidle2",
            timeout: 45000,
          });

          navigationSuccess = true;
        }
      } catch (error) {
        this.logger?.debug(`Click navigation failed: ${error.message}`);
      }

      // Strategy 2: Direct navigation using URL if click failed
      if (!navigationSuccess && paginationInfo.url) {
        this.logger?.debug(
          `Click failed, trying direct navigation to: ${paginationInfo.url}`
        );

        try {
          await page.goto(paginationInfo.url, {
            waitUntil: "networkidle2",
            timeout: 45000,
          });
          navigationSuccess = true;
        } catch (error) {
          this.logger?.debug(`Direct navigation failed: ${error.message}`);
        }
      }

      if (navigationSuccess) {
        const newUrl = page.url();
        this.logger?.debug(`Successfully navigated to: ${newUrl}`);

        // Add human-like delay after page load
        if (this.config.humanLike) {
          const loadDelay = Math.floor(Math.random() * 2000) + 1000;
          await sleep(loadDelay, "page load reading time", this.logger);
        }

        return true;
      } else {
        this.logger?.warn("All navigation strategies failed");
        return false;
      }
    } catch (error) {
      this.logger?.error("Failed to navigate to next page:", error.message);
      return false;
    }
  }

  /**
   * Filter results based on dork pattern matching
   * @param {Array} results - Array of result objects
   * @param {string} dork - The dork query used
   * @returns {Array} Filtered results that match the dork pattern
   */
  filterResultsByDork(results, dork) {
    if (!results || results.length === 0) {
      return results;
    }

    this.logger?.debug(
      `Filtering ${results.length} results with dork: ${dork}`
    );

    try {
      // Parse the dork to extract filtering patterns
      const patterns = this.parseDorkPatterns(dork);

      if (patterns.length === 0) {
        this.logger?.debug(
          "No filterable patterns found in dork, returning all results"
        );
        // Log all URLs as added when no filtering is applied
        results.forEach((result, index) => {
          if (result.url) {
            this.logger?.info(
              `✅ URL ADDED [${index + 1}/${results.length}]: ${result.url}`,
              {
                title: result.title || "No title",
                reason: "No filtering patterns found in dork",
              }
            );
          }
        });
        return results;
      }

      // Filter results based on extracted patterns
      const filteredResults = [];
      let addedCount = 0;
      let filteredCount = 0;

      results.forEach((result, index) => {
        if (!result.url) {
          filteredCount++;
          this.logger?.info(
            `❌ URL FILTERED [${index + 1}/${results.length}]: (no URL)`,
            {
              title: result.title || "No title",
              reason: "Missing URL",
            }
          );
          return;
        }

        // Check if URL matches any of the dork patterns
        const matchedPattern = patterns.find((pattern) =>
          this.matchesPattern(result, pattern)
        );

        if (matchedPattern) {
          addedCount++;
          filteredResults.push(result);
          this.logger?.info(
            `✅ URL ADDED [${index + 1}/${results.length}]: ${result.url}`,
            {
              title: result.title || "No title",
              matchedPattern: `${matchedPattern.type}:${matchedPattern.value}`,
              reason: `Matches dork pattern`,
            }
          );
        } else {
          filteredCount++;
          this.logger?.info(
            `❌ URL FILTERED [${index + 1}/${results.length}]: ${result.url}`,
            {
              title: result.title || "No title",
              patterns: patterns.map((p) => `${p.type}:${p.value}`).join(", "),
              reason: "Does not match any dork pattern",
            }
          );
        }
      });

      this.logger?.info(
        `Dork filtering completed: ${results.length} → ${filteredResults.length} results (${addedCount} added, ${filteredCount} filtered out)`
      );
      return filteredResults;
    } catch (error) {
      this.logger?.warn(
        "Error during dork filtering, returning unfiltered results",
        {
          error: error.message,
          dork: dork.substring(0, 50),
        }
      );
      return results;
    }
  }

  /**
   * Parse dork query to extract filterable patterns
   * @param {string} dork - The dork query
   * @returns {Array} Array of pattern objects
   */
  parseDorkPatterns(dork) {
    const patterns = [];

    // Comprehensive pattern matching for ALL Google, Bing, and DuckDuckGo dork operators
    const dorkPatterns = [
      // === Universal Operators (Google, Bing, DDG) ===
      {
        regex: /site:([^\s]+)/gi,
        type: "site",
        extract: (match) => match[1],
      },
      {
        regex: /filetype:([^\s]+)/gi,
        type: "filetype",
        extract: (match) => match[1],
      },
      {
        regex: /ext:([^\s]+)/gi,
        type: "filetype",
        extract: (match) => match[1],
      },
      {
        regex: /inurl:([^\s"]+|"[^"]*")/gi,
        type: "inurl",
        extract: (match) => match[1].replace(/"/g, ""),
      },
      {
        regex: /intitle:([^\s"]+|"[^"]*")/gi,
        type: "intitle",
        extract: (match) => match[1].replace(/"/g, ""),
      },
      {
        regex: /inanchor:([^\s"]+|"[^"]*")/gi,
        type: "inanchor",
        extract: (match) => match[1].replace(/"/g, ""),
      },
      {
        regex: /inbody:([^\s"]+|"[^"]*")/gi,
        type: "inbody",
        extract: (match) => match[1].replace(/"/g, ""),
      },
      {
        regex: /loc:([^\s"]+|"[^"]*")/gi,
        type: "location",
        extract: (match) => match[1].replace(/"/g, ""),
      },
      {
        regex: /location:([^\s"]+|"[^"]*")/gi,
        type: "location",
        extract: (match) => match[1].replace(/"/g, ""),
      },

      // === Google-Specific Operators ===
      {
        regex: /allinurl:([^\s"]+|"[^"]*")/gi,
        type: "allinurl",
        extract: (match) => match[1].replace(/"/g, ""),
      },
      {
        regex: /allintitle:([^\s"]+|"[^"]*")/gi,
        type: "allintitle",
        extract: (match) => match[1].replace(/"/g, ""),
      },
      {
        regex: /allintext:([^\s"]+|"[^"]*")/gi,
        type: "allintext",
        extract: (match) => match[1].replace(/"/g, ""),
      },
      {
        regex: /allinanchor:([^\s"]+|"[^"]*")/gi,
        type: "allinanchor",
        extract: (match) => match[1].replace(/"/g, ""),
      },
      {
        regex: /cache:([^\s"]+|"[^"]*")/gi,
        type: "cache",
        extract: (match) => match[1].replace(/"/g, ""),
      },
      {
        regex: /related:([^\s"]+|"[^"]*")/gi,
        type: "related",
        extract: (match) => match[1].replace(/"/g, ""),
      },
      {
        regex: /daterange:(\d+-\d+)/gi,
        type: "daterange",
        extract: (match) => match[1],
      },
      {
        regex: /author:([^\s"]+|"[^"]*")/gi,
        type: "author",
        extract: (match) => match[1].replace(/"/g, ""),
      },
      {
        regex: /source:([^\s"]+|"[^"]*")/gi,
        type: "source",
        extract: (match) => match[1].replace(/"/g, ""),
      },
      {
        regex: /info:([^\s"]+|"[^"]*")/gi,
        type: "info",
        extract: (match) => match[1].replace(/"/g, ""),
      },
      {
        regex: /link:([^\s"]+|"[^"]*")/gi,
        type: "link",
        extract: (match) => match[1].replace(/"/g, ""),
      },

      // === Bing & DuckDuckGo Operators ===
      {
        regex: /ip:([^\s]+)/gi,
        type: "ip",
        extract: (match) => match[1],
      },
      {
        regex: /language:([^\s]+)/gi,
        type: "language",
        extract: (match) => match[1],
      },
      {
        regex: /prefer:([^\s"]+|"[^"]*")/gi,
        type: "prefer",
        extract: (match) => match[1].replace(/"/g, ""),
      },
      {
        regex: /feed:([^\s]+)/gi,
        type: "feed",
        extract: (match) => match[1],
      },
      {
        regex: /hasfeed:([^\s]+)/gi,
        type: "hasfeed",
        extract: (match) => match[1],
      },
      {
        regex: /url:([^\s]+)/gi,
        type: "url",
        extract: (match) => match[1],
      },
      
      // === DuckDuckGo-Specific Operators ===
      {
        regex: /-site:([^\s]+)/gi,
        type: "exclude-site",
        extract: (match) => match[1],
      },
      {
        regex: /~"([^"]+)"/gi,
        type: "near-phrase",
        extract: (match) => match[1],
      },

      // === General Search Modifiers (Google, Bing, DDG) ===
      {
        regex: /"([^"]+)"/gi,
        type: "phrase",
        extract: (match) => match[1],
      },
      {
        regex: /-([^\s"]+|"[^"]*")/gi,
        type: "exclude",
        extract: (match) => match[1].replace(/"/g, ""),
      },
      {
        regex: /\+([^\s"]+|"[^"]*")/gi,
        type: "required",
        extract: (match) => match[1].replace(/"/g, ""),
      },
      {
        regex: /(\w*\*\w*)/gi,
        type: "wildcard",
        extract: (match) => match[1],
      },
      {
        regex: /before:(\d{4}-\d{2}-\d{2}|\d{4}\/\d{2}\/\d{2})/gi,
        type: "before",
        extract: (match) => match[1],
      },
      {
        regex: /after:(\d{4}-\d{2}-\d{2}|\d{4}\/\d{2}\/\d{2})/gi,
        type: "after",
        extract: (match) => match[1],
      },
      {
        regex: /numrange:(\d+)-(\d+)/gi,
        type: "numrange",
        extract: (match) => `${match[1]}-${match[2]}`,
      },
      {
        regex: /(\d+)\.\.(\d+)/gi,
        type: "numrange",
        extract: (match) => `${match[1]}-${match[2]}`,
      },
    ];

    // Extract patterns from dork
    for (const dorkPattern of dorkPatterns) {
      let match;
      const regex = new RegExp(
        dorkPattern.regex.source,
        dorkPattern.regex.flags
      );

      while ((match = regex.exec(dork)) !== null) {
        const value = dorkPattern.extract(match);
        if (value && value.trim()) {
          patterns.push({
            type: dorkPattern.type,
            value: value.trim(),
            original: match[0],
          });
        }
      }
    }

    // Handle logical operators (OR, AND)
    if (dork.toUpperCase().includes(' OR ')) {
      patterns.push({
        type: "logical",
        value: "OR",
        original: "OR",
      });
    }
    
    if (dork.toUpperCase().includes(' AND ')) {
      patterns.push({
        type: "logical",
        value: "AND",
        original: "AND",
      });
    }

    this.logger?.debug(
      `Extracted ${patterns.length} patterns from dork: ${dork}`,
      patterns
    );
    return patterns;
  }

  /**
   * Check if a result matches a specific pattern
   * @param {Object} result - Result object with url, title, description
   * @param {Object} pattern - Pattern object with type and value
   * @returns {boolean} True if result matches pattern
   */
  matchesPattern(result, pattern) {
    const { type, value } = pattern;
    const url = result.url.toLowerCase();
    const title = (result.title || "").toLowerCase();
    const description = (result.description || "").toLowerCase();

    switch (type) {
      case "inurl": {
        // Check if URL contains the specified pattern with precise matching
        const urlPattern = value.toLowerCase();
        
        if (urlPattern.includes('?') || urlPattern.includes('=') || urlPattern.includes('&')) {
          // Precise matching for query parameter patterns
          const escapedPattern = urlPattern
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
            .replace(/\\\?/g, '\\?'); // Keep ? as literal
            
          const regex = new RegExp(escapedPattern, 'i');
          return regex.test(url);
        } else {
          // Flexible matching for simple text patterns
          return url.includes(urlPattern);
        }
      }

      case "allinurl": {
        // Check if ALL words are present in URL
        const words = value.toLowerCase().split(/\s+/);
        return words.every(word => url.includes(word.trim()));
      }

      case "site": {
        // Check if URL is from the specified site/domain
        let sitePattern = value.toLowerCase();

        if (sitePattern.startsWith("*.")) {
          // *.example.com should match any subdomain of example.com
          const baseDomain = sitePattern.substring(2);
          return url.includes(baseDomain);
        } else {
          // Regular site match - check domain portion of URL
          try {
            const urlObj = new URL(result.url);
            const hostname = urlObj.hostname.toLowerCase();
            return hostname === sitePattern || hostname.endsWith('.' + sitePattern);
          } catch (e) {
            // Fallback to simple string matching
            return url.includes(sitePattern);
          }
        }
      }

      case "intitle": {
        // Check if title contains the specified text
        const titlePattern = value.toLowerCase();
        return title.includes(titlePattern);
      }

      case "allintitle": {
        // Check if ALL words are present in title
        const words = value.toLowerCase().split(/\s+/);
        return words.every(word => title.includes(word.trim()));
      }

      case "intext": {
        // Check if title or description contains the specified text
        const textPattern = value.toLowerCase();
        return title.includes(textPattern) || description.includes(textPattern);
      }

      case "allintext": {
        // Check if ALL words are present in text content
        const words = value.toLowerCase().split(/\s+/);
        const fullText = `${title} ${description}`.toLowerCase();
        return words.every(word => fullText.includes(word.trim()));
      }

      case "inanchor": {
        // Note: Anchor text is typically not available in search results
        // This would require additional scraping to determine
        // For now, we'll check if the pattern appears in the title as a proxy
        const anchorPattern = value.toLowerCase();
        return title.includes(anchorPattern);
      }

      case "allinanchor": {
        // Check if ALL words would be in anchor text (using title as proxy)
        const words = value.toLowerCase().split(/\s+/);
        return words.every(word => title.includes(word.trim()));
      }

      case "filetype": {
        // Check if URL ends with the specified file extension
        const filePattern = value.toLowerCase();
        const extensions = [
          `.${filePattern}`,
          `.${filePattern}?`, // With query parameters
          `.${filePattern}#`, // With fragments
        ];
        return extensions.some((ext) => url.includes(ext));
      }

      case "phrase": {
        // Check if exact phrase appears in title or description
        const phrasePattern = value.toLowerCase();
        const fullText = `${title} ${description}`.toLowerCase();
        return fullText.includes(phrasePattern);
      }

      case "exclude": {
        // Check if excluded term is NOT present
        const excludePattern = value.toLowerCase();
        const fullText = `${title} ${description} ${url}`.toLowerCase();
        return !fullText.includes(excludePattern);
      }

      case "required": {
        // Check if required term is present
        const requiredPattern = value.toLowerCase();
        const fullText = `${title} ${description} ${url}`.toLowerCase();
        return fullText.includes(requiredPattern);
      }

      case "wildcard": {
        // Handle wildcard patterns
        const wildcardPattern = value.toLowerCase();
        const regex = new RegExp(wildcardPattern.replace(/\*/g, '.*'), 'i');
        const fullText = `${title} ${description} ${url}`.toLowerCase();
        return regex.test(fullText);
      }

      case "numrange": {
        // Check if numbers in the specified range appear in URL or content
        const [min, max] = value.split('-').map(n => parseInt(n));
        const fullText = `${title} ${description} ${url}`;
        const numbers = fullText.match(/\d+/g) || [];
        return numbers.some(num => {
          const n = parseInt(num);
          return n >= min && n <= max;
        });
      }

      case "author": {
        // Check if author name appears in title or description
        const authorPattern = value.toLowerCase();
        const fullText = `${title} ${description}`.toLowerCase();
        return fullText.includes(authorPattern);
      }

      case "source": {
        // Check if source appears in URL or content
        const sourcePattern = value.toLowerCase();
        const fullText = `${title} ${description} ${url}`.toLowerCase();
        return fullText.includes(sourcePattern);
      }

      case "location": {
        // Check if location appears in title or description
        const locationPattern = value.toLowerCase();
        const fullText = `${title} ${description}`.toLowerCase();
        return fullText.includes(locationPattern);
      }

      // === Bing & DuckDuckGo Operators ===
      case "ip": {
        // IP filtering would require resolving the domain, which is out of scope for result filtering
        // This is a search-level operator
        return true;
      }
      
      case "language": {
        // Language detection is complex; this is a search-level operator
        return true;
      }
      
      case "prefer": {
        // This is a search-level operator to prefer certain terms
        const preferPattern = value.toLowerCase();
        const fullText = `${title} ${description}`.toLowerCase();
        return fullText.includes(preferPattern);
      }
      
      case "feed":
      case "hasfeed": {
        // Feed detection would require inspecting page for RSS/Atom links
        return true;
      }
      
      case "url": {
        // Similar to inurl but may have different engine-specific behavior
        return url.includes(value.toLowerCase());
      }
      
      // === DuckDuckGo-Specific Operators ===
      case "exclude-site": {
        // Check if URL is NOT from the specified site/domain
        const sitePattern = value.toLowerCase();
        try {
          const urlObj = new URL(result.url);
          const hostname = urlObj.hostname.toLowerCase();
          return !(hostname === sitePattern || hostname.endsWith('.' + sitePattern));
        } catch (e) {
          return !url.includes(sitePattern);
        }
      }
      
      case "near-phrase": {
        // Complex proximity search, for now, we check if all words appear
        const words = value.toLowerCase().split(/\s+/);
        const fullText = `${title} ${description}`.toLowerCase();
        return words.every(word => fullText.includes(word.trim()));
      }

      case "before": 
      case "after": 
      case "daterange": {
        // Date filtering is complex and would require parsing publish dates
        // For now, we'll allow all results through as this is search-level filtering
        this.logger?.debug(`Date filtering (${type}) not implemented for result filtering`);
        return true;
      }

      case "cache": 
      case "info": 
      case "related": 
      case "link": {
        // These are search operators that modify the query type, not result filters
        this.logger?.debug(`Query operator (${type}) not applicable for result filtering`);
        return true;
      }

      case "logical": {
        // Logical operators are handled at the pattern combination level
        return true;
      }

      default:
        this.logger?.debug(`Unknown pattern type: ${type}`);
        return true; // Don't filter out if we don't understand the pattern
    }
  }

  /**
   * Perform delay between searches with movement-only warmup
   */
  async delayBetweenSearches() {
    let minDelay, maxDelay, randomDelay;

    // Check if extended delay mode is enabled (1-5 minutes)
    if (this.config.extendedDelay) {
      minDelay = 60 * 1000; // 1 minute in milliseconds
      maxDelay = 300 * 1000; // 5 minutes in milliseconds
      randomDelay =
        Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

      this.logger?.info(
        `🕐 Extended delay mode: waiting ${Math.round(
          randomDelay / 60000
        )}m ${Math.round((randomDelay % 60000) / 1000)}s before next search`,
        {
          mode: "extended",
          range: "1-5 minutes",
          selected: `${Math.round(randomDelay / 60000)}m ${Math.round(
            (randomDelay % 60000) / 1000
          )}s`,
        }
      );
      
      // Send initial countdown to dashboard
      if (this.dashboard && this.dashboard.setProcessingStatus) {
        const totalSeconds = Math.ceil(randomDelay / 1000);
        this.dashboard.setProcessingStatus(`⏳ Extended delay: ${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s remaining`);
      }
    } else {
      // Use standard delay range
      minDelay = (this.config.minDelay || this.config.delay || 10) * 1000;
      maxDelay = (this.config.maxDelay || this.config.delay || 45) * 1000;
      randomDelay =
        Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

      this.logger?.info(
        `Delaying ${
          randomDelay / 1000
        }s before next search with MOVEMENT-ONLY warmup`,
        {
          mode: "standard",
          range: `${minDelay / 1000}-${maxDelay / 1000}s`,
          selected: `${randomDelay / 1000}s`,
        }
      );
      
      // Send initial countdown to dashboard
      if (this.dashboard && this.dashboard.setProcessingStatus) {
        const totalSeconds = Math.ceil(randomDelay / 1000);
        this.dashboard.setProcessingStatus(`⏳ Delay: ${totalSeconds}s remaining`);
      }
    }

    if (this.config.humanLike && this.pageData) {
      // MOVEMENT-ONLY delay - no clicking, just cursor movements
      const { page, cursor } = this.pageData;

      try {
        const delayStartTime = Date.now();
        const delayEndTime = delayStartTime + randomDelay;
        let lastCountdownTime = Math.ceil(randomDelay / 1000);

        // Stay on current page and ONLY move cursor
        while (Date.now() < delayEndTime) {
          // Update countdown every second
          const delayRemainingTime = Math.ceil((delayEndTime - Date.now()) / 1000);
          if (delayRemainingTime !== lastCountdownTime && delayRemainingTime > 0) {
            lastCountdownTime = delayRemainingTime;
            
            // Send countdown updates to dashboard
            if (this.dashboard && this.dashboard.setProcessingStatus) {
              if (this.config.extendedDelay) {
                const minutes = Math.floor(delayRemainingTime / 60);
                const seconds = delayRemainingTime % 60;
                this.dashboard.setProcessingStatus(`⏳ Extended delay: ${minutes}m ${seconds}s remaining`);
              } else {
                this.dashboard.setProcessingStatus(`⏳ Delay: ${delayRemainingTime}s remaining`);
              }
            }
          }
          // Verify we're still on Google (don't navigate if we're not)
          const currentUrl = page.url();
          if (!currentUrl.includes("google.com")) {
            this.logger?.warn(
              `⚠️ Navigated away from Google during delay to: ${currentUrl}`
            );
            this.logger?.info("🔄 Returning to Google for remainder of delay");

            // Go back to Google
            await page.goto("https://www.google.com", {
              waitUntil: "domcontentloaded",
              timeout: 15000,
            });
            await sleep(
              2000,
              "after returning to Google during delay",
              this.logger
            );
          }

          // Perform ONLY safe cursor movements (absolutely NO clicking or interaction)
          this.logger?.debug(
            "Performing MOVEMENT-ONLY delay - no interactions"
          );

          // Import and use performSafeCursorMovements
          const { performSafeCursorMovements } = await import(
            "../browser/browserManager.js"
          );
          await performSafeCursorMovements(page, cursor, this.logger);

          // Pause between movement sessions
          const pauseTime = Math.random() * 3000 + 2000; // 2-5 seconds
          const remainingTime = delayEndTime - Date.now();

          // Don't pause longer than remaining time
          const actualPauseTime = Math.min(pauseTime, remainingTime);
          if (actualPauseTime > 0) {
            await sleep(actualPauseTime, "delay movement pause", this.logger);
          }
        }

        this.logger?.debug("Movement-only delay completed successfully");
        
        // Clear countdown status
        if (this.dashboard && this.dashboard.setProcessingStatus) {
          this.dashboard.setProcessingStatus(null);
        }
      } catch (error) {
        this.logger?.warn(
          "Error during movement-only delay, falling back to regular sleep",
          {
            error: error.message,
          }
        );
        // Fallback to regular sleep if movement fails
        await sleep(
          randomDelay,
          "fallback delay between searches",
          this.logger
        );
        
        // Clear countdown status
        if (this.dashboard && this.dashboard.setProcessingStatus) {
          this.dashboard.setProcessingStatus(null);
        }
      }
    } else {
      // Fallback to regular sleep
      await sleep(randomDelay, "delay between searches", this.logger);
      
      // Clear countdown status
      if (this.dashboard && this.dashboard.setProcessingStatus) {
        this.dashboard.setProcessingStatus(null);
      }
    }
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    try {
      this.logger?.info("Cleaning up MultiEngineDorker resources");

      // Stop background monitor
      if (this.backgroundMonitor) {
        this.backgroundMonitor.stop();
        this.backgroundMonitor = null;
      }

      if (this.browser) {
        await closeBrowser(this.browser, this.logger);
      }

      if (this.currentProxy) {
        await deleteProxy(this.currentProxy.id, this.logger);
      }

      this.logger?.info("MultiEngineDorker cleanup completed");
    } catch (error) {
      this.logger?.error("Error during cleanup", { error: error.message });
    }
  }

  /**
   * Perform batch search of multiple dorks using specified engines
   * @param {string[]} dorks - Array of dork queries
   * @param {number} maxResults - Maximum results per dork
   * @param {string[]} engines - Array of search engines to use
   * @returns {Promise<Array>} Combined search results
   */
  async performBatchSearch(dorks, maxResults = 30, engines = ['google']) {
    try {
      this.logger?.info("Starting batch search", {
        dorkCount: dorks.length,
        engines: engines.join(", "),
      });

      let allResults = [];
      
      // Initialize session if dashboard exists
      if (this.dashboard) {
        this.dashboard.startSession(dorks.length * engines.length);
      }

      // Search all dorks with each engine before moving to next engine
      for (const engine of engines) {
        this.logger?.info(`Starting searches with ${engine}...`);
        
        if (this.dashboard) {
          this.dashboard.addLog("info", `🚀 Starting batch search with ${engine}...`);
          this.dashboard.setProcessingStatus(`Processing with ${engine}`);
        }

        for (const dork of dorks) {
          if (this.dashboard) {
            this.dashboard.setCurrentDork(dork);
          }

          try {
            const results = await this.performSearch(dork, maxResults, [engine]);
            allResults = [...allResults, ...results];

            // Add delay between dorks
            if (dorks.indexOf(dork) < dorks.length - 1) {
              await sleep(3000 + Math.random() * 2000, "between dorks", this.logger);
            }
          } catch (error) {
            this.logger?.error(`Failed to search dork with ${engine}:`, {
              dork: dork.substring(0, 50),
              error: error.message,
            });
            if (this.dashboard) {
              this.dashboard.incrementProcessed();
              this.dashboard.incrementFailed();
            }
          }
        }

        // Add longer delay between engines
        if (engines.indexOf(engine) < engines.length - 1) {
          await sleep(5000 + Math.random() * 3000, "between engines", this.logger);
        }
      }

      // End session and get summary
      if (this.dashboard) {
        this.dashboard.endSession();
        const summary = this.dashboard.getSessionSummary();
        this.dashboard.addLog("info", `📊 Batch Search Summary: ${JSON.stringify(summary)}`);
      }

      return allResults;
    } catch (error) {
      this.logger?.error("Batch search failed", { error: error.message });
      return [];
    }
  }
}

