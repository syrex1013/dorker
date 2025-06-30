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

      // Update status to searching
      if (this.dashboard && this.dashboard.setStatus) {
        this.dashboard.setStatus("searching");
      }
      if (this.dashboard && this.dashboard.addLog) {
        this.dashboard.addLog(
          "info",
          `🔍 Searching for: ${dork.substring(0, 50)}...`
        );
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

        const { handleConsentOptimized } = await import(
          "../browser/browserManager.js"
        );
        await handleConsentOptimized(page, cursor, this.logger);

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
          await handleConsentOptimized(page, cursor, this.logger);
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
      let searchBoxSelector = null; // Track which selector worked
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
            // Verify the element is visible and interactable
            const isVisible = await page.evaluate((sel) => {
              const element = document.querySelector(sel);
              if (!element) return false;

              const style = window.getComputedStyle(element);
              const rect = element.getBoundingClientRect();

              return (
                element.offsetWidth > 0 &&
                element.offsetHeight > 0 &&
                style.visibility !== "hidden" &&
                style.display !== "none" &&
                element.type !== "hidden" &&
                rect.width > 0 &&
                rect.height > 0
              );
            }, selector);

            if (isVisible) {
              searchBoxSelector = selector; // Remember which selector worked
              this.logger?.debug(
                `Found visible search box with selector: ${selector}`
              );

              // Scroll the search box into view
              await page.evaluate((sel) => {
                const element = document.querySelector(sel);
                if (element) {
                  element.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                    inline: "center",
                  });
                }
              }, selector);

              // Wait for scroll to complete
              await sleep(
                500,
                "after scrolling search box into view",
                this.logger
              );
              break;
            } else {
              this.logger?.debug(
                `Found search box with selector ${selector} but it's not visible/interactable`
              );
              searchBox = null; // Reset so we keep looking
            }
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
            const { handleConsentOptimized } = await import(
              "../browser/browserManager.js"
            );
            await handleConsentOptimized(page, cursor, this.logger);
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
        const { handleConsentOptimized } = await import(
          "../browser/browserManager.js"
        );
        await handleConsentOptimized(page, cursor, this.logger);
        await sleep(2000, "after final consent handling", this.logger);

        // Try to find search box one final time
        for (const selector of searchBoxSelectors) {
          searchBox = await page.$(selector);
          if (searchBox) {
            searchBoxSelector = selector; // Update the selector if found
            break;
          }
        }
      }

      if (!searchBox || !searchBoxSelector) {
        throw new Error(
          "Search box not found after multiple attempts - may be blocked by consent or CAPTCHA"
        );
      }

      // Clear search box completely and enter dork
      this.logger?.debug(
        `Clearing search box completely using selector: ${searchBoxSelector}`
      );

      // Click search box with human-like behavior using ghost cursor
      this.logger?.debug("Attempting to click search box with ghost cursor");

      // Add small random delay before clicking (human reaction time)
      const reactionTime = 150 + Math.random() * 200;
      await sleep(reactionTime, "human reaction time", this.logger);

      try {
        // Try ghost cursor click with timeout
        if (cursor && typeof cursor.click === "function") {
          try {
            await Promise.race([
              cursor.click(searchBox),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("cursor timeout")), 3000)
              ),
            ]);
            this.logger?.debug("Ghost cursor click on search box successful");
          } catch (clickError) {
            this.logger?.debug(
              `Ghost cursor failed on search box: ${clickError.message}, using fallback`
            );
            throw new Error("cursor failed");
          }
        } else {
          throw new Error("No valid cursor");
        }
      } catch (_cursorError) {
        this.logger?.debug("Using fallback click for search box");
        await searchBox.click();
      }

      // Add delay after clicking like a human would
      const postClickDelay = 100 + Math.random() * 150;
      await sleep(postClickDelay, "after click delay", this.logger);

      // Ensure the search box has focus
      await searchBox.focus();
      await sleep(200, "after focusing search box", this.logger);

      // Select all text in search box (cross-platform)
      if (process.platform === "darwin") {
        // Mac - use Command key
        await page.keyboard.down("Meta");
        await page.keyboard.press("a");
        await page.keyboard.up("Meta");
      } else {
        // Windows/Linux - use Ctrl key
        await page.keyboard.down("Control");
        await page.keyboard.press("a");
        await page.keyboard.up("Control");
      }
      await sleep(100, "after selecting all text", this.logger);

      // Delete selected text
      await page.keyboard.press("Delete");
      await sleep(200, "after deleting text", this.logger);

      // Double-check by getting current value and clearing if needed - using the correct selector
      const currentValue = await page.evaluate((selector) => {
        const input = document.querySelector(selector);
        return input
          ? input.value || input.textContent || input.innerText || ""
          : "";
      }, searchBoxSelector);

      if (currentValue && currentValue.trim() !== "") {
        this.logger?.debug(
          `Search box still has content: "${currentValue}", force clearing...`
        );
        await page.evaluate((selector) => {
          const input = document.querySelector(selector);
          if (input) {
            // Try multiple clearing methods
            input.value = "";
            input.textContent = "";
            input.innerText = "";

            // Dispatch multiple events to ensure clearing
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            input.dispatchEvent(new Event("keyup", { bubbles: true }));

            // Focus and manually clear again
            input.focus();
            input.select();
          }
        }, searchBoxSelector);
        await sleep(500, "after force clearing", this.logger);

        // Verify clearing worked
        const verifyValue = await page.evaluate((selector) => {
          const input = document.querySelector(selector);
          return input
            ? input.value || input.textContent || input.innerText || ""
            : "";
        }, searchBoxSelector);

        if (verifyValue && verifyValue.trim() !== "") {
          this.logger?.warn(
            `Search box still not empty after force clear: "${verifyValue}"`
          );
          // Last resort: type Ctrl+A and Delete again
          await searchBox.focus();
          await sleep(200);
          await page.keyboard.down(
            process.platform === "darwin" ? "Meta" : "Control"
          );
          await page.keyboard.press("a");
          await page.keyboard.up(
            process.platform === "darwin" ? "Meta" : "Control"
          );
          await sleep(100);
          await page.keyboard.press("Backspace");
          await page.keyboard.press("Delete");
          await sleep(300, "after final clearing attempt", this.logger);
        }
      }

      const clearDelay = 500 + Math.random() * 1000;
      await sleep(clearDelay, "after clearing search box", this.logger);

      // Type dork with human-like delays
      const dorkTypeDelay = 50 + Math.random() * 100;
      this.logger?.debug(
        `Typing dork query: "${dork.substring(0, 50)}${
          dork.length > 50 ? "..." : ""
        }" with ${Math.round(dorkTypeDelay)}ms delay between keystrokes`
      );

      // Disable autocomplete and suggestions before typing
      await page.evaluate((selector) => {
        const input = document.querySelector(selector);
        if (input) {
          input.setAttribute("autocomplete", "off");
          input.setAttribute("autocorrect", "off");
          input.setAttribute("autocapitalize", "off");
          input.setAttribute("spellcheck", "false");
        }
      }, searchBoxSelector);

      // Type the dork character by character with human-like behavior and verification
      for (let i = 0; i < dork.length; i++) {
        // Add slight variation in typing speed
        const charDelay = dorkTypeDelay + (Math.random() - 0.5) * 20; // ±10ms variation

        await page.keyboard.type(dork[i]);
        await sleep(
          Math.max(30, charDelay),
          `typing character ${i + 1}`,
          this.logger
        );

        // Occasionally add small pauses (like humans thinking)
        if (Math.random() < 0.15) {
          // 15% chance of pause
          const thinkingPause = 50 + Math.random() * 100;
          await sleep(
            thinkingPause,
            "thinking pause while typing",
            this.logger
          );
        }

        // Every few characters, verify the content hasn't been auto-corrected
        if (i % 5 === 0 || i === dork.length - 1) {
          const currentValue = await page.evaluate((selector) => {
            const input = document.querySelector(selector);
            return input ? input.value : "";
          }, searchBoxSelector);

          const expectedValue = dork.substring(0, i + 1);
          if (currentValue !== expectedValue) {
            this.logger?.debug(
              `Autocomplete interference detected at position ${i}. Expected: "${expectedValue}", Got: "${currentValue}"`
            );
            // Correct the value immediately
            await page.evaluate(
              (selector, correctValue) => {
                const input = document.querySelector(selector);
                if (input) {
                  input.value = correctValue;

                  // Only use setSelectionRange if the element supports it
                  if (
                    input.type !== "hidden" &&
                    typeof input.setSelectionRange === "function" &&
                    input.offsetWidth > 0 &&
                    input.offsetHeight > 0
                  ) {
                    try {
                      input.setSelectionRange(
                        correctValue.length,
                        correctValue.length
                      );
                    } catch (e) {
                      // Some input types may not support selection, ignore silently
                      console.debug(
                        "setSelectionRange not supported:",
                        e.message
                      );
                    }
                  }

                  // Dispatch events to ensure the change is registered
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                  input.dispatchEvent(new Event("change", { bubbles: true }));
                }
              },
              searchBoxSelector,
              expectedValue
            );
          }
        }
      }

      this.logger?.debug(`Finished typing dork query`);

      // Verify the dork was typed correctly - using the correct selector
      const finalValue = await page.evaluate((selector) => {
        const input = document.querySelector(selector);
        return input
          ? input.value || input.textContent || input.innerText || ""
          : "";
      }, searchBoxSelector);

      this.logger?.debug(`Search box final value: "${finalValue}"`);

      if (finalValue !== dork) {
        this.logger?.warn(
          `Dork mismatch! Expected: "${dork}", Got: "${finalValue}"`
        );
        // Try to fix by clearing and retyping
        await page.evaluate(
          (selector, correctDork) => {
            const input = document.querySelector(selector);
            if (input) {
              // Clear completely first
              input.value = "";
              input.textContent = "";
              input.innerText = "";

              // Set the correct value
              input.value = correctDork;
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));
            }
          },
          searchBoxSelector,
          dork
        );
        await sleep(500, "after correcting dork value", this.logger);
      }

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

        const { handleConsentOptimized } = await import(
          "../browser/browserManager.js"
        );
        await handleConsentOptimized(page, cursor, this.logger);

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

      // Handle pagination if enabled
      const maxPages = this.config.maxPages || 1;
      let allResults = [...results];
      let currentPage = 1;

      if (maxPages > 1 && results.length > 0) {
        this.logger?.info(
          `Pagination enabled: searching up to ${maxPages} pages`
        );

        while (currentPage < maxPages) {
          // Check if pagination is available
          const hasNextPage = await this.checkPaginationAvailable(page);

          if (!hasNextPage) {
            this.logger?.info(
              `No more pages available, stopping at page ${currentPage}`
            );
            break;
          }

          // Log pagination attempt
          this.logger?.info(
            `📄 Processing page ${currentPage + 1}/${maxPages} for dork`
          );
          if (this.dashboard && this.dashboard.addLog) {
            this.dashboard.addLog(
              "info",
              `📄 Scraping page ${currentPage + 1}/${maxPages}`
            );
          }

          // Navigate to next page
          const navigated = await this.navigateToNextPage(page);
          if (!navigated) {
            this.logger?.warn(
              `Failed to navigate to page ${
                currentPage + 1
              }, stopping pagination`
            );
            break;
          }

          // Wait for page load
          await sleep(
            2000 + Math.random() * 3000,
            `waiting for page ${currentPage + 1} to load`,
            this.logger
          );

          // Check for CAPTCHA after page navigation
          const postPageCaptcha = await detectCaptcha(page, this.logger);
          if (postPageCaptcha) {
            logWithDedup(
              "warning",
              "🚨 CAPTCHA detected after pagination",
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
              this.logger?.warn(
                "CAPTCHA handling failed during pagination, stopping"
              );
              break;
            }
          }

          // Extract results from current page
          const pageResults = await this.extractResults(page, maxResults);

          if (pageResults.length === 0) {
            this.logger?.info(
              `No results found on page ${currentPage + 1}, stopping pagination`
            );
            break;
          }

          // Add to total results
          allResults = allResults.concat(pageResults);
          currentPage++;

          this.logger?.info(
            `Found ${pageResults.length} results on page ${currentPage}, total: ${allResults.length}`
          );

          // Human-like pause between pages
          if (this.config.humanLike && currentPage < maxPages) {
            const pageDelay = Math.floor(Math.random() * 5000) + 3000;
            this.logger?.debug(
              `Page reading delay: ${Math.round(pageDelay / 1000)}s`
            );
            await sleep(
              pageDelay,
              "reading page before pagination",
              this.logger
            );
          }
        }

        if (maxPages > 1) {
          this.logger?.info(
            `Pagination complete: ${allResults.length} total results from ${currentPage} pages`
          );
          if (this.dashboard && this.dashboard.addLog) {
            this.dashboard.addLog(
              "success",
              `📄 Scraped ${currentPage} pages, found ${allResults.length} total results`
            );
          }
        }
      }

      // Simulate human reading time
      if (this.config.humanLike && allResults.length > 0) {
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
        resultCount: allResults.length,
        pagesScraped: currentPage,
        searchCount: this.searchCount,
      });

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
   * Perform delay between searches with random timing
   */
  async delayBetweenSearches() {
    // Use new delay range if available, fallback to old single delay for backward compatibility
    const minDelay = (this.config.minDelay || this.config.delay || 10) * 1000;
    const maxDelay = (this.config.maxDelay || this.config.delay || 45) * 1000;

    // Generate random delay within the specified range
    const randomDelay =
      Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

    const maxPause = this.config.maxPause * 1000;

    this.logger?.info(`Delaying ${randomDelay / 1000}s before next search`, {
      range: `${minDelay / 1000}-${maxDelay / 1000}s`,
      selected: `${randomDelay / 1000}s`,
    });

    if (this.config.humanLike) {
      await humanDelay(randomDelay, maxPause, this.logger);
    } else {
      await sleep(randomDelay, "delay between searches", this.logger);
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
