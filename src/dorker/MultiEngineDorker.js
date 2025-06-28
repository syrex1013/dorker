import chalk from "chalk";
import { sleep, humanDelay } from "../utils/sleep.js";
import { logWithDedup } from "../utils/logger.js";
import {
  testAsocksAPI,
  generateProxy,
  deleteProxy,
} from "../proxy/asocksApi.js";
import { detectCaptcha, handleCaptcha } from "../captcha/detector.js";
import {
  launchBrowser,
  createPage,
  performWarmup,
  navigateToGoogle,
  closeBrowser,
  simulateHumanBrowsing,
} from "../browser/browserManager.js";
import BackgroundCaptchaMonitor from "../captcha/backgroundMonitor.js";

/**
 * Multi-Engine Dorker class for performing Google dorking with anti-detection
 */
class MultiEngineDorker {
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

      this.browser = await launchBrowser(this.config, this.logger);
      this.pageData = await createPage(this.browser, this.config, this.logger);

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
   * Perform a single dork search
   * @param {string} dork - The dork query
   * @param {number} maxResults - Maximum results to return
   * @returns {Promise<Array>} Search results
   */
  async performSearch(dork, maxResults = 30) {
    try {
      this.logger?.info("Performing search", {
        dork: dork.substring(0, 50),
        maxResults,
      });

      const { page, cursor } = this.pageData;

      // Check if we need to restart browser
      if (this.searchCount >= this.restartThreshold) {
        await this.restartBrowser();
      }

      // Navigate to Google if not already there
      if (!page.url().includes("google.com")) {
        await navigateToGoogle(this.pageData, this.logger);
      }

      // Handle CAPTCHA if present with proxy switching callback
      const switchProxyCallback = this.config.autoProxy
        ? async () => {
            try {
              // Generate new proxy
              const newProxy = await generateProxy(this.logger);
              if (newProxy) {
                // Restart browser with new proxy
                await this.cleanup();
                this.currentProxy = newProxy;
                await this.initialize();
                return true;
              }
              return false;
            } catch (error) {
              this.logger?.error("Error switching proxy", {
                error: error.message,
              });
              return false;
            }
          }
        : null;

      const captchaHandled = await handleCaptcha(
        page,
        this.config,
        this.logger,
        switchProxyCallback,
        this.dashboard
      );
      if (!captchaHandled) {
        logWithDedup(
          "error",
          "❌ CAPTCHA handling failed",
          chalk.red,
          this.logger
        );
        return [];
      }

      // Always check for consent page before searching (including Polish)
      const pageInfo = await page.evaluate(() => {
        const pageText = document.body.textContent || "";
        const url = window.location.href;
        return {
          isConsentPage:
            pageText.includes("Before you continue to Google") ||
            pageText.includes("We use cookies and data") ||
            pageText.includes("Zanim przejdziesz do Google") ||
            pageText.includes("Używamy plików cookie") ||
            pageText.includes("Zaakceptuj wszystkie") ||
            url.includes("consent.google") ||
            document.querySelector(".containerGm3") !== null ||
            document.querySelector(".boxGm3") !== null ||
            pageText.includes("Sign inSign inBefore you continue"),
          currentUrl: url,
          pagePreview: pageText.slice(0, 150),
        };
      });

      const isConsentPage = pageInfo.isConsentPage;

      // Log page info for debugging
      this.logger?.debug("Page check before search:", {
        isConsentPage,
        currentUrl: pageInfo.currentUrl,
        pagePreview: pageInfo.pagePreview,
      });

      if (isConsentPage) {
        this.logger?.info("Consent page detected during search, handling...");
        this.logger?.debug("Consent page details:", pageInfo);

        const { handleConsent } = await import("../browser/browserManager.js");
        await handleConsent(page, cursor, this.logger);

        // Wait for page to settle after consent
        await sleep(3000, "after consent handling", this.logger);

        // Check if we're still on consent page
        const stillOnConsent = await page.evaluate(() => {
          const pageText = document.body.textContent || "";
          return (
            pageText.includes("Before you continue to Google") ||
            pageText.includes("We use cookies and data")
          );
        });

        if (stillOnConsent) {
          this.logger?.warn(
            "Still on consent page after handling, trying navigation..."
          );
          await page.goto("https://www.google.com", {
            waitUntil: "networkidle0",
          });
          await sleep(2000);

          // Try consent handling one more time
          await handleConsent(page, cursor, this.logger);
          await sleep(2000, "after consent retry", this.logger);
        }

        // Navigate back to Google if needed
        if (
          !page.url().includes("google.com/search") &&
          !page.url().includes("google.com/?")
        ) {
          await navigateToGoogle(this.pageData, this.logger);
          await sleep(2000, "after navigating back to Google", this.logger);
        }
      }

      // Pre-search thinking pause (40% chance)
      if (Math.random() < 0.4) {
        const thinkTime = Math.floor(Math.random() * 5000) + 2000;
        logWithDedup(
          "info",
          `🤔 Pre-search thinking pause: ${Math.round(thinkTime / 1000)}s`,
          chalk.gray,
          this.logger
        );
        await sleep(thinkTime, "pre-search thinking pause", this.logger);
      }

      // Find search box with multiple selectors and retries
      let searchBox = null;
      const searchBoxSelectors = [
        'input[name="q"]',
        'input[type="text"][title*="Search"]',
        'input[aria-label*="Search"]',
        'textarea[name="q"]',
        "#APjFqb", // New Google search box ID
        ".gLFyf", // Another Google search box class
        'input[role="combobox"]',
      ];

      // Try multiple times to find search box
      for (let attempt = 0; attempt < 3 && !searchBox; attempt++) {
        if (attempt > 0) {
          this.logger?.debug(`Search box attempt ${attempt + 1}/3`);
          await sleep(2000, "between search box attempts", this.logger);
        }

        for (const selector of searchBoxSelectors) {
          searchBox = await page.$(selector);
          if (searchBox) {
            this.logger?.debug(`Found search box with selector: ${selector}`);
            break;
          }
        }

        // If still no search box, check if we need to handle consent again
        if (!searchBox) {
          const stillOnConsent = await page.evaluate(() => {
            const pageText = document.body.textContent || "";
            return (
              pageText.includes("Before you continue to Google") ||
              pageText.includes("We use cookies and data") ||
              pageText.includes("Zanim przejdziesz do Google") ||
              pageText.includes("Używamy plików cookie") ||
              pageText.includes("Zaakceptuj wszystkie") ||
              document.querySelector(".containerGm3") !== null
            );
          });

          if (stillOnConsent) {
            this.logger?.info("Still on consent page, handling again...");
            const { handleConsent } = await import(
              "../browser/browserManager.js"
            );
            await handleConsent(page, cursor, this.logger);
            await sleep(
              3000,
              "after handling consent on search retry",
              this.logger
            );
          } else {
            // Try refreshing or navigating to Google
            this.logger?.info("Search box not found, refreshing page...");
            await page.reload({ waitUntil: "networkidle0" });
            await sleep(3000, "after page refresh", this.logger);
          }
        }
      }

      if (!searchBox) {
        // Last resort: try to navigate to Google homepage
        this.logger?.warn(
          "Search box still not found, navigating to Google homepage..."
        );
        await page.goto("https://www.google.com", {
          waitUntil: "networkidle0",
        });
        await sleep(3000, "after navigating to Google homepage", this.logger);

        // Handle consent one more time if needed
        const { handleConsent } = await import("../browser/browserManager.js");
        await handleConsent(page, cursor, this.logger);
        await sleep(2000, "after final consent handling", this.logger);

        // Try to find search box one final time
        for (const selector of searchBoxSelectors) {
          searchBox = await page.$(selector);
          if (searchBox) break;
        }
      }

      if (!searchBox) {
        throw new Error(
          "Search box not found after multiple attempts - may be blocked by consent or CAPTCHA"
        );
      }

      // Clear search box and enter dork
      this.logger?.debug(`Clicking search box to clear it (triple click)`);
      await searchBox.click({ clickCount: 3 });
      this.logger?.debug(`Triple click completed, pressing Backspace`);
      await page.keyboard.press("Backspace");
      const clearDelay = 500 + Math.random() * 1000;
      await sleep(clearDelay, "after clearing search box", this.logger);

      // Type dork with human-like delays
      const dorkTypeDelay = 50 + Math.random() * 100;
      this.logger?.debug(
        `Typing dork query: "${dork.substring(0, 50)}${
          dork.length > 50 ? "..." : ""
        }" with ${Math.round(dorkTypeDelay)}ms delay between keystrokes`
      );
      await page.type('input[name="q"]', dork, {
        delay: dorkTypeDelay,
      });
      this.logger?.debug(`Finished typing dork query`);

      const postDorkDelay = 1000 + Math.random() * 2000;
      await sleep(postDorkDelay, "after typing dork", this.logger);

      // Submit search
      this.logger?.debug(`Pressing Enter to submit search`);
      await page.keyboard.press("Enter");
      this.logger?.debug(`Enter key pressed, waiting for navigation`);
      await page.waitForNavigation({
        waitUntil: "networkidle0",
        timeout: 30000,
      });
      this.logger?.debug(`Navigation completed`);

      // Check if we landed on consent page after search
      const postSearchPageInfo = await page.evaluate(() => {
        const pageText = document.body.textContent || "";
        const url = window.location.href;
        return {
          isConsentPage:
            pageText.includes("Before you continue to Google") ||
            pageText.includes("We use cookies and data") ||
            pageText.includes("Zanim przejdziesz do Google") ||
            pageText.includes("Używamy plików cookie") ||
            url.includes("consent.google") ||
            document.querySelector(".containerGm3") !== null,
          currentUrl: url,
          pagePreview: pageText.slice(0, 150),
        };
      });

      if (postSearchPageInfo.isConsentPage) {
        this.logger?.info("Consent page appeared after search, handling...");
        this.logger?.debug("Post-search consent details:", postSearchPageInfo);

        const { handleConsent } = await import("../browser/browserManager.js");
        await handleConsent(page, cursor, this.logger);

        // Wait for navigation back to results
        await sleep(
          5000,
          "waiting for navigation back to results",
          this.logger
        );

        // Verify we're now on results page
        const finalUrl = page.url();
        this.logger?.debug("Final URL after consent handling:", finalUrl);

        if (!finalUrl.includes("google.com/search")) {
          this.logger?.warn(
            "Not on search results page, may need manual intervention"
          );
        }
      }

      // Check for CAPTCHA after search
      const postSearchCaptcha = await detectCaptcha(page, this.logger);
      if (postSearchCaptcha) {
        logWithDedup(
          "warning",
          "🚨 CAPTCHA detected after search",
          chalk.red,
          this.logger
        );
        const handled = await handleCaptcha(
          page,
          this.config,
          this.logger,
          switchProxyCallback,
          this.dashboard
        );
        if (!handled) {
          return [];
        }
      }

      // Extract results
      const results = await this.extractResults(page, maxResults);

      // Simulate human reading time
      if (this.config.humanLike && results.length > 0) {
        const readingTime = Math.floor(Math.random() * 8000) + 5000;
        logWithDedup(
          "info",
          `📖 Reading results: ${Math.round(readingTime / 1000)}s`,
          chalk.gray,
          this.logger
        );
        await simulateHumanBrowsing(page, cursor, readingTime, this.logger);
      }

      this.searchCount++;
      this.logger?.info("Search completed", {
        dork: dork.substring(0, 50),
        resultCount: results.length,
        searchCount: this.searchCount,
      });

      return results;
    } catch (error) {
      this.logger?.error("Search failed", {
        dork: dork.substring(0, 50),
        error: error.message,
      });
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

        // Helper function to decode URL from Google redirect
        function extractRealUrl(href) {
          if (!href) return null;

          // Handle Google redirect URLs (/url?q=...)
          if (href.includes("/url?q=")) {
            try {
              const urlPart = href.split("/url?")[1];
              const urlParams = new URLSearchParams(urlPart);
              const realUrl = urlParams.get("q");
              if (realUrl) {
                return decodeURIComponent(realUrl);
              }
            } catch (e) {
              console.log("Error parsing redirect URL:", e);
            }
          }

          // Handle direct URLs
          if (href.startsWith("http")) {
            return href;
          }

          return null;
        }

        // Helper function to clean text
        function cleanText(text) {
          return text ? text.trim().replace(/\s+/g, " ") : "";
        }

        // Strategy 1: Modern Google results (2024+ format) - Priority search
        console.log("Trying modern Google results extraction...");

        // Look for modern result containers
        const modernContainers = Array.from(
          document.querySelectorAll(
            'div[data-ved] a[href*="/url?q="], a[href*="/url?q="][data-ved]'
          )
        );

        console.log(`Found ${modernContainers.length} modern result links`);

        for (const link of modernContainers) {
          if (results.length >= max) break;

          const url = extractRealUrl(link.href);
          if (!url || seenUrls.has(url)) continue;

          // Skip Google internal URLs
          if (
            url.includes("google.com") ||
            url.includes("gstatic.com") ||
            url.includes("googleusercontent.com") ||
            url.includes("youtube.com") ||
            url.includes("accounts.google.com") ||
            url.includes("maps.google.com") ||
            url.includes("translate.google.com")
          ) {
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

          if (title && title !== "No title" && title.length > 0) {
            seenUrls.add(url);
            results.push({
              title: title,
              url: url,
              description: description,
            });
            console.log(`Extracted result: ${title} -> ${url}`);
          }
        }

        // Strategy 2: Fallback - Look for all links that look like search results
        if (results.length === 0) {
          console.log("No modern results found, trying fallback extraction...");

          const allLinks = Array.from(
            document.querySelectorAll('a[href*="/url?q="], a[href^="http"]')
          );

          console.log(`Found ${allLinks.length} potential result links`);

          for (const link of allLinks) {
            if (results.length >= max) break;

            const url = extractRealUrl(link.href);
            if (!url || seenUrls.has(url)) continue;

            // Skip Google internal URLs
            if (
              url.includes("google.com") ||
              url.includes("gstatic.com") ||
              url.includes("googleusercontent.com") ||
              url.includes("youtube.com") ||
              url.includes("accounts.google.com")
            ) {
              continue;
            }

            // Try to find title from various places
            let title = "";

            // Check if link has h3 parent or child
            const h3Element =
              link.querySelector("h3") ||
              link.closest("h3") ||
              link.parentElement?.querySelector("h3") ||
              link.parentElement?.parentElement?.querySelector("h3");

            if (h3Element) {
              title = cleanText(h3Element.textContent);
            } else {
              // Fallback to link text or nearby text
              title =
                cleanText(link.textContent) ||
                cleanText(link.getAttribute("aria-label")) ||
                "No title";
            }

            // Try to find description
            let description = "";

            // Look for description in common Google result classes
            const container =
              link.closest("div.g, div[data-ved], .rc, div") ||
              link.parentElement;
            if (container) {
              const descSelectors = [
                ".VwiC3b",
                ".s",
                ".st",
                'span[style*="color"]',
                'div[style*="color"]',
                ".f",
                ".fG8Fp",
                ".aCOpRe",
              ];

              for (const selector of descSelectors) {
                const descElement = container.querySelector(selector);
                if (descElement && descElement.textContent.trim()) {
                  description = cleanText(descElement.textContent);
                  break;
                }
              }
            }

            if (title && title !== "No title") {
              seenUrls.add(url);
              results.push({
                title: title,
                url: url,
                description: description,
              });
            }
          }
        }

        // Strategy 3: Traditional container-based extraction (final fallback)
        if (results.length === 0) {
          console.log(
            "No results from link extraction, trying container-based extraction..."
          );

          const containerSelectors = [
            "div.g", // Standard Google result
            "div[data-ved]", // Alternative result selector
            ".rc", // Classic result container
            "div.Gx5Zad", // Another Google container
            "div.Wt5Tfe", // Mobile result container
            "div.MjjYud", // Modern result container
            "div.kvH3mc", // Another modern container
            "div.N54PNb", // Additional modern container
            "div.Jb0Zif", // More modern containers
          ];

          for (const selector of containerSelectors) {
            if (results.length >= max) break;

            const elements = document.querySelectorAll(selector);

            for (let i = 0; i < Math.min(elements.length, max); i++) {
              if (results.length >= max) break;

              const element = elements[i];

              // Try to find link
              const linkElement =
                element.querySelector("a[href]") ||
                element.querySelector("a[data-ved]") ||
                element.querySelector("h3 a");

              if (!linkElement) continue;

              const url = extractRealUrl(linkElement.href);
              if (!url || seenUrls.has(url)) continue;

              // Skip Google internal URLs
              if (url.includes("google.com") || url.includes("gstatic.com")) {
                continue;
              }

              // Extract title with modern selectors
              const titleSelectors = [
                "h3.zBAuLc",
                "h3.l97dzf",
                "h3.LC20lb", // Modern title classes
                "h3",
                "a h3", // Classic title selectors
                ".zBAuLc",
                ".l97dzf",
                ".LC20lb", // Modern classes without h3
                ".ilUpNd",
                ".UFvD1",
                ".aSRlid",
                ".IwSnJ", // Additional modern classes
              ];

              let title = "";
              for (const selector of titleSelectors) {
                const titleElement = element.querySelector(selector);
                if (titleElement && titleElement.textContent.trim()) {
                  title = cleanText(titleElement.textContent);
                  break;
                }
              }

              if (!title) {
                title = linkElement
                  ? cleanText(linkElement.textContent)
                  : "No title";
              }

              // Extract description with modern selectors
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

              let description = "";
              for (const selector of descSelectors) {
                const descElement = element.querySelector(selector);
                if (descElement && descElement.textContent.trim()) {
                  description = cleanText(descElement.textContent);
                  break;
                }
              }

              if (title && title !== "No title") {
                seenUrls.add(url);
                results.push({
                  title: title,
                  url: url,
                  description: description,
                });
              }
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
            dataVedLinks: document.querySelectorAll(
              'a[href*="/url?q="][data-ved]'
            ).length,
            urlLinks: document.querySelectorAll('a[href*="/url?q="]').length,
            allLinks: document.querySelectorAll("a[href]").length,
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
              h3: document.querySelectorAll("h3").length,
            },
          };
          console.log("Debug info:", debugInfo);

          // Sample some actual HTML structure
          const sampleLink = document.querySelector('a[href*="/url?q="]');
          if (sampleLink) {
            console.log(
              "Sample link HTML:",
              sampleLink.outerHTML.substring(0, 500)
            );
            console.log(
              "Sample link container:",
              sampleLink
                .closest("div[data-ved], div.g, div.MjjYud")
                ?.outerHTML.substring(0, 300)
            );
          }
        }

        return results;
      }, maxResults);

      this.logger?.debug("Results extracted", { count: results.length });

      // Log first few results for debugging
      if (results.length > 0) {
        this.logger?.debug("Sample results:", {
          firstResult: results[0],
          totalFound: results.length,
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
      this.logger?.error("Failed to extract results", { error: error.message });
      return [];
    }
  }

  /**
   * Perform delay between searches
   */
  async delayBetweenSearches() {
    const baseDelay = this.config.delay * 1000;
    const maxPause = this.config.maxPause * 1000;

    if (this.config.humanLike) {
      await humanDelay(baseDelay, maxPause, this.logger);
    } else {
      await sleep(baseDelay, "delay between searches", this.logger);
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
}

export default MultiEngineDorker;
