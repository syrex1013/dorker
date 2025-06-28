import puppeteer from "puppeteer";
import chalk from "chalk";
import { createCursor } from "ghost-cursor";
import { generateFingerprint } from "../utils/fingerprint.js";
import { sleep } from "../utils/sleep.js";
import { logWithDedup } from "../utils/logger.js";

// Cache for browser instances
let browserInstance = null;
let pageInstance = null;

/**
 * Launch browser with stealth configuration
 * @param {Object} config - Configuration object
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<Object>} Browser instance
 */
async function launchBrowser(config, logger = null) {
  try {
    logger?.info("Launching browser with anti-detection configuration");

    const fingerprint = generateFingerprint();

    const browserArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=TranslateUI",
      "--disable-ipc-flooding-protection",
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
      "--disable-extensions",
      "--disable-plugins",
      "--disable-images",
      "--disable-javascript-harmony-shipping",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-translate",
      "--no-default-browser-check",
      "--no-pings",
      "--password-store=basic",
      "--use-mock-keychain",
      `--user-agent=${config.userAgent || fingerprint.userAgent}`,
      "--window-size=1366,768",
    ];

    // Add proxy configuration if available
    if (config.proxyConfig) {
      browserArgs.push(
        `--proxy-server=${config.proxyConfig.type}://${config.proxyConfig.host}:${config.proxyConfig.port}`
      );
    }

    const browser = await puppeteer.launch({
      headless: config.headless !== false,
      args: browserArgs,
      ignoreHTTPSErrors: true,
      ignoreDefaultArgs: ["--enable-automation"],
      defaultViewport: {
        width: fingerprint.screen.width,
        height: fingerprint.screen.height,
      },
    });

    browserInstance = browser;
    logger?.info("Browser launched successfully", {
      headless: config.headless,
      userAgent: config.userAgent || fingerprint.userAgent,
      viewport: fingerprint.screen,
    });

    return browser;
  } catch (error) {
    logger?.error("Failed to launch browser", { error: error.message });
    throw error;
  }
}

/**
 * Create a new page with anti-detection measures
 * @param {Object} browser - Browser instance
 * @param {Object} config - Configuration object
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<Object>} Page instance with cursor
 */
async function createPage(browser, config, logger = null) {
  try {
    const page = await browser.newPage();
    pageInstance = page;

    // Enable stealth mode
    await page.evaluateOnNewDocument(() => {
      // Remove webdriver property
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });

      // Mock languages and plugins
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });

      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
    });

    // Set proxy authentication if needed
    if (config.proxyConfig?.username && config.proxyConfig?.password) {
      await page.authenticate({
        username: config.proxyConfig.username,
        password: config.proxyConfig.password,
      });
    }

    // Create ghost cursor for human-like interactions
    const cursor = createCursor(page);

    logger?.info("Page created with anti-detection measures");
    return { page, cursor };
  } catch (error) {
    logger?.error("Failed to create page", { error: error.message });
    throw error;
  }
}

/**
 * Perform warm-up browsing session
 * @param {Object} pageData - Page and cursor data
 * @param {Object} logger - Winston logger instance
 */
async function performWarmup(pageData, logger = null) {
  const { page, cursor } = pageData;

  try {
    logger?.info("Starting warm-up browsing session");
    logWithDedup("info", "🔥 Starting warm-up session...", chalk.blue, logger);

    // Generate warm-up time (30-60 seconds)
    const warmupTime = Math.floor(Math.random() * 30000) + 30000;
    logger?.info(`Warm-up session duration: ${warmupTime}ms`);

    // Navigate to Google
    await page.goto("https://www.google.com", { waitUntil: "networkidle0" });
    await sleep(2000 + Math.random() * 3000);

    // Handle consent if present
    await handleConsent(page, cursor, logger);

    // Perform some natural searches
    const warmupSearches = [
      "weather today",
      "news",
      "latest technology trends",
      "best restaurants nearby",
    ];

    const searchQuery =
      warmupSearches[Math.floor(Math.random() * warmupSearches.length)];
    logger?.info(`Performing warm-up search: ${searchQuery}`);

    // Find and use search box
    const searchBox = await page.$('input[name="q"]');
    if (searchBox) {
      await cursor.click(searchBox);
      await sleep(500 + Math.random() * 1000);

      // Type with human-like delays
      await page.type('input[name="q"]', searchQuery, {
        delay: 50 + Math.random() * 100,
      });
      await sleep(1000 + Math.random() * 2000);

      // Press Enter
      await page.keyboard.press("Enter");
      await page.waitForNavigation({
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      // Scroll and interact naturally
      await simulateHumanBrowsing(
        page,
        cursor,
        10000 + Math.random() * 10000,
        logger
      );
    }

    logWithDedup("info", "✅ Warm-up session completed", chalk.green, logger);
    logger?.info("Warm-up session completed successfully");
  } catch (error) {
    logger?.warn("Warm-up session encountered issues", {
      error: error.message,
    });
    logWithDedup(
      "warning",
      "⚠️ Warm-up had some issues, continuing...",
      chalk.yellow,
      logger
    );
  }
}

/**
 * Handle Google consent forms
 * @param {Object} page - Puppeteer page
 * @param {Object} cursor - Ghost cursor
 * @param {Object} logger - Winston logger instance
 */
async function handleConsent(page, cursor, logger = null) {
  try {
    // Wait for potential consent form
    await sleep(3000);

    // Get current URL to determine consent page type
    const currentUrl = page.url();

    // Special handling for consent.google.com URLs
    if (currentUrl.includes("consent.google.com")) {
      logger?.info(
        "Detected consent.google.com URL, using text-based button selection..."
      );

      try {
        // Find Accept all button by text content (avoiding attributes)
        const acceptButton = await page.evaluateHandle(() => {
          // Look for any input or button element with "Accept all" text
          const allElements = Array.from(
            document.querySelectorAll('input[type="submit"], button')
          );

          for (const element of allElements) {
            const text =
              element.value || element.textContent || element.innerText || "";
            if (
              text.trim() === "Accept all" ||
              text.trim() === "Zaakceptuj wszystkie" ||
              text.trim() === "Zaakceptuj wszystko"
            ) {
              return element;
            }
          }

          // Fallback: look in forms for submit buttons with Accept text
          const forms = Array.from(document.querySelectorAll("form"));
          for (const form of forms) {
            const submitInputs = Array.from(
              form.querySelectorAll('input[type="submit"]')
            );
            for (const input of submitInputs) {
              if (
                input.value &&
                (input.value.includes("Accept all") ||
                  input.value.includes("Zaakceptuj wszyst"))
              ) {
                return input;
              }
            }
          }

          return null;
        });

        const buttonExists = await page.evaluate((el) => !!el, acceptButton);

        if (buttonExists) {
          logger?.info("Found Accept all button on consent.google.com");

          // Scroll into view and click
          await page.evaluate((el) => {
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          }, acceptButton);

          await sleep(1000);
          await cursor.click(acceptButton);
          await sleep(3000);

          // Verify we left the consent page
          const newUrl = page.url();
          if (!newUrl.includes("consent.google.com")) {
            logger?.info("Successfully handled consent.google.com page");
            return;
          } else {
            logger?.warn(
              "Still on consent.google.com after clicking Accept all"
            );
          }
        } else {
          logger?.warn(
            "Could not find Accept all button on consent.google.com"
          );
        }
      } catch (error) {
        logger?.warn("Error handling consent.google.com page:", error.message);
      }
    }

    // Check if we're on a consent page (standard detection)
    const isConsentPage = await page.evaluate(() => {
      // Look for consent page indicators (including Polish)
      const indicators = [
        "Before you continue to Google",
        "Zanim przejdziesz do Google",
        "We use cookies and data",
        "Używamy plików cookie",
        "Accept all",
        "Zaakceptuj wszystkie",
        "Reject all",
        "Odrzuć wszystkie",
        "consent.google.com",
        "Zaakceptuj wszystko",
        "Zgadzam się",
        "containerGm3",
        "boxGm3",
        "saveButtonContainer",
      ];

      const pageText = document.body.textContent || "";
      const pageHTML = document.body.innerHTML || "";

      return indicators.some(
        (indicator) =>
          pageText.includes(indicator) || pageHTML.includes(indicator)
      );
    });

    if (!isConsentPage) {
      logger?.debug("No consent page detected");
      return;
    }

    logger?.info("Consent page detected, attempting to handle...");

    // Modern Google consent selectors (in order of preference)
    const consentSelectors = [
      // Polish language support (prioritized for PL region)
      'input[type="submit"][value="Zaakceptuj wszystkie"]',
      'input[type="submit"][value="Zaakceptuj wszystko"]',
      'button:contains("Zaakceptuj wszystkie")',
      'button:contains("Zaakceptuj wszystko")',
      'input[aria-label="Zaakceptuj wszystkie"]',
      'input[aria-label="Zaakceptuj wszystko"]',
      'button[aria-label="Zaakceptuj wszystkie"]',
      'button[aria-label="Zaakceptuj wszystko"]',
      'button:contains("Zgadzam się")',
      'input[value="Zgadzam się"]',

      // Modern consent form submit buttons
      'input[type="submit"][value="Accept all"]',
      'input[type="submit"][aria-label="Accept all"]',
      'input[value="Accept all"]',

      // Button elements
      'button[aria-label="Accept all"]',
      'button:contains("Accept all")',

      // Legacy selectors
      'button[id="L2AGLb"]',
      'div[role="button"]:contains("Accept all")',
      '.VfPpkd-LgbsSe[aria-label="Accept all"]',

      // Alternative text variations
      'input[type="submit"][value="I agree"]',
      'button:contains("I agree")',
      'button:contains("Accept")',

      // Generic consent buttons
      "[data-ved] button",
      ".saveButtonContainer button",
      '.saveButtonContainer input[type="submit"]',
      // Specific container selectors
      '.saveButtonContainer form:nth-child(2) input[type="submit"]',
      '.boxGm3 form:nth-child(2) input[type="submit"]',
    ];

    // Try each selector
    for (const selector of consentSelectors) {
      try {
        // Wait a bit for the page to stabilize
        await sleep(1000);

        let element = null;

        // Handle special :contains() selectors
        if (selector.includes(":contains(")) {
          const text = selector.match(/:contains\("([^"]+)"\)/)?.[1];
          if (text) {
            element = await page.evaluateHandle((searchText) => {
              const allElements = Array.from(
                document.querySelectorAll('button, input[type="submit"]')
              );
              return allElements.find(
                (el) =>
                  el.textContent?.includes(searchText) ||
                  el.value?.includes(searchText) ||
                  el.getAttribute("aria-label")?.includes(searchText)
              );
            }, text);

            // Check if element was found
            const elementExists = await page.evaluate((el) => !!el, element);
            if (!elementExists) {
              element = null;
            }
          }
        } else {
          // Regular selector
          element = await page.$(selector);
        }

        if (element) {
          logger?.info(`Found consent element with selector: ${selector}`);

          // Scroll element into view
          await page.evaluate((el) => {
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          }, element);

          await sleep(1000);

          // Click using ghost cursor for human-like interaction
          await cursor.click(element);

          // Wait for navigation or page change
          await sleep(3000);

          // Verify we're no longer on consent page
          const stillOnConsent = await page.evaluate(() => {
            const pageText = document.body.textContent || "";
            return (
              pageText.includes("Before you continue to Google") ||
              pageText.includes("We use cookies and data") ||
              pageText.includes("Zanim przejdziesz do Google") ||
              pageText.includes("Używamy plików cookie") ||
              document.querySelector(".containerGm3") !== null
            );
          });

          if (!stillOnConsent) {
            logger?.info("Successfully handled consent form");
            return;
          } else {
            logger?.debug("Still on consent page, trying next selector");
          }
        }
      } catch (e) {
        logger?.debug(`Selector ${selector} failed:`, e.message);
        // Continue to next selector
      }
    }

    // If we get here, try a more aggressive approach
    logger?.info("Standard selectors failed, trying JavaScript submission...");

    try {
      await page.evaluate(() => {
        // Try to find and submit "Accept all" or Polish equivalent forms
        const forms = Array.from(document.querySelectorAll("form"));
        for (const form of forms) {
          // Check for Accept or Zaakceptuj buttons
          const submitButton = form.querySelector(
            'input[type="submit"][value*="Accept"], input[type="submit"][value*="Zaakceptuj"]'
          );
          if (
            submitButton &&
            (submitButton.value.includes("Accept all") ||
              submitButton.value.includes("Zaakceptuj wszystkie") ||
              submitButton.value.includes("Zaakceptuj wszystko"))
          ) {
            submitButton.click();
            return;
          }
        }

        // Fallback: try any button with "Accept" or "Zaakceptuj" text
        const buttons = Array.from(
          document.querySelectorAll('button, input[type="submit"]')
        );
        for (const button of buttons) {
          const text =
            button.textContent ||
            button.value ||
            button.getAttribute("aria-label") ||
            "";
          if (
            text.includes("Accept all") ||
            text.includes("Zaakceptuj wszystkie") ||
            text.includes("Zaakceptuj wszystko") ||
            text.includes("Zgadzam się")
          ) {
            button.click();
            return;
          }
        }

        // Last resort: click the second form submit button (usually "Accept all")
        const allSubmits = document.querySelectorAll(
          '.saveButtonContainer input[type="submit"]'
        );
        if (allSubmits.length >= 2) {
          allSubmits[1].click(); // Second button is typically "Accept all"
        }
      });

      await sleep(3000);
      logger?.info("Attempted JavaScript consent handling");
    } catch (jsError) {
      logger?.warn("JavaScript consent handling failed:", jsError.message);
    }

    logger?.warn(
      "Could not automatically handle consent form - may need manual intervention"
    );
  } catch (error) {
    logger?.warn("Error handling consent", { error: error.message });
  }
}

/**
 * Simulate human-like browsing behavior
 * @param {Object} page - Puppeteer page
 * @param {Object} cursor - Ghost cursor
 * @param {number} duration - Duration in milliseconds
 * @param {Object} logger - Winston logger instance
 */
async function simulateHumanBrowsing(page, cursor, duration, logger = null) {
  const startTime = Date.now();

  while (Date.now() - startTime < duration) {
    try {
      // Random human actions (reduced click frequency to avoid issues)
      const actions = ["scroll", "move", "pause", "scroll", "move"];

      const action = actions[Math.floor(Math.random() * actions.length)];

      switch (action) {
        case "scroll": {
          try {
            const scrollDistance = Math.random() * 500 + 100;
            const direction = Math.random() > 0.5 ? 1 : -1;
            await page.evaluate((distance) => {
              window.scrollBy(0, distance);
            }, scrollDistance * direction);
          } catch (scrollError) {
            logger?.debug("Scroll action failed", {
              error: scrollError.message,
            });
          }
          break;
        }

        case "move": {
          try {
            // Get viewport size to ensure coordinates are within bounds
            const viewport = await page.viewport();
            const maxX = Math.min(viewport?.width || 1366, 1366) - 100;
            const maxY = Math.min(viewport?.height || 768, 768) - 100;

            const x = Math.random() * (maxX - 200) + 100;
            const y = Math.random() * (maxY - 200) + 100;

            await cursor.move(x, y);
          } catch (moveError) {
            logger?.debug("Cursor move failed", { error: moveError.message });
          }
          break;
        }

        case "pause":
          await sleep(1000 + Math.random() * 3000);
          break;

        case "click": {
          try {
            // Only occasionally perform clicks and ensure safe coordinates
            if (Math.random() < 0.3) {
              // 30% chance of clicking
              const viewport = await page.viewport();
              const maxX = Math.min(viewport?.width || 1366, 1366) - 200;
              const maxY = Math.min(viewport?.height || 768, 768) - 200;

              const clickX = Math.random() * (maxX - 300) + 200;
              const clickY = Math.random() * (maxY - 300) + 200;

              // Use page.mouse.click instead of cursor.click for more reliability
              await page.mouse.click(clickX, clickY);
            }
          } catch (clickError) {
            logger?.debug("Click action failed", { error: clickError.message });
          }
          break;
        }
      }

      // Random delay between actions
      await sleep(1000 + Math.random() * 2000);
    } catch (error) {
      // Log error but continue with next action
      logger?.debug("Human simulation action failed", {
        error: error.message,
        stack: error.stack?.slice(0, 200),
      });

      // Short pause before continuing
      await sleep(500);
    }
  }
}

/**
 * Navigate to Google search with human-like behavior
 * @param {Object} pageData - Page and cursor data
 * @param {Object} logger - Winston logger instance
 */
async function navigateToGoogle(pageData, logger = null) {
  const { page } = pageData;

  try {
    logger?.info("Navigating to Google");
    await page.goto("https://www.google.com", {
      waitUntil: "networkidle0",
      timeout: 30000,
    });

    await sleep(2000 + Math.random() * 3000);

    // Always check and handle consent after navigation
    await handleConsent(page, pageData.cursor, logger);

    // Additional wait to ensure page is ready after consent
    await sleep(1000);

    logger?.info("Successfully navigated to Google");
  } catch (error) {
    logger?.error("Failed to navigate to Google", { error: error.message });
    throw error;
  }
}

/**
 * Clean up browser resources
 * @param {Object} browser - Browser instance
 * @param {Object} logger - Winston logger instance
 */
async function closeBrowser(browser, logger = null) {
  try {
    if (browser) {
      await browser.close();
      browserInstance = null;
      pageInstance = null;
      logger?.info("Browser closed successfully");
    }
  } catch (error) {
    logger?.error("Error closing browser", { error: error.message });
  }
}

/**
 * Get current browser and page instances
 * @returns {Object} Current browser and page instances
 */
function getCurrentInstances() {
  return {
    browser: browserInstance,
    page: pageInstance,
  };
}

export {
  launchBrowser,
  createPage,
  performWarmup,
  handleConsent,
  simulateHumanBrowsing,
  navigateToGoogle,
  closeBrowser,
  getCurrentInstances,
};
