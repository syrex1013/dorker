import { connect } from "puppeteer-real-browser";
import chalk from "chalk";
import { createCursor } from "ghost-cursor";
import { sleep } from "../utils/sleep.js";
import { logWithDedup } from "../utils/logger.js";

// Cache for browser instances
let browserInstance = null;
let pageInstance = null;

/**
 * Human-like typing function with realistic patterns
 * @param {Object} element - Element to type into
 * @param {string} text - Text to type
 * @param {Object} options - Typing options
 * @param {Object} logger - Logger instance
 */
async function _humanLikeType(element, text, options = {}, logger = null) {
  const {
    minDelay = 80,
    maxDelay = 180,
    mistakes = true,
    pauseChance = 0.1,
    backspaceChance = 0.05,
  } = options;

  try {
    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // Realistic typing delay with variation
      const baseDelay = Math.random() * (maxDelay - minDelay) + minDelay;
      const delay = baseDelay + (Math.random() * 50 - 25); // ±25ms variation

      // Occasional longer pauses (thinking)
      if (Math.random() < pauseChance) {
        const thinkTime = Math.random() * 800 + 200; // 200-1000ms thinking pause
        logger?.debug(`Thinking pause: ${Math.round(thinkTime)}ms`);
        await sleep(thinkTime, "thinking pause", logger);
      }

      // Occasional mistakes and corrections
      if (mistakes && Math.random() < backspaceChance && i > 2) {
        // Type wrong character
        const wrongChars = "qwertyuiopasdfghjklzxcvbnm";
        const wrongChar =
          wrongChars[Math.floor(Math.random() * wrongChars.length)];
        await element.type(wrongChar, { delay: delay * 0.8 });

        // Pause to "notice" mistake
        await sleep(100 + Math.random() * 300, "noticing mistake", logger);

        // Backspace to correct
        await element.press("Backspace", { delay: delay * 0.6 });
        await sleep(50 + Math.random() * 100, "after correction", logger);
      }

      // Type the actual character
      await element.type(char, { delay: Math.max(delay, 30) });

      // Slightly longer delays for spaces (more natural)
      if (char === " ") {
        await sleep(Math.random() * 100 + 50, "after space", logger);
      }
    }
  } catch (error) {
    logger?.debug("Error in human-like typing", { error: error.message });
    // Fallback to simple typing
    await element.type(text, { delay: (minDelay + maxDelay) / 2 });
  }
}

/**
 * Enhanced ghost cursor click with human-like behavior
 * @param {Object} cursor - Ghost cursor instance
 * @param {Object} element - Element to click
 * @param {Object} page - Page instance for fallback
 * @param {Object} logger - Logger instance
 */
async function _humanLikeClick(cursor, element, page, logger = null) {
  try {
    if (!cursor || typeof cursor.click !== "function") {
      throw new Error("No valid cursor available");
    }

    // Add slight delay before click (human reaction time)
    const reactionTime = Math.random() * 200 + 100; // 100-300ms
    await sleep(reactionTime, "human reaction time", logger);

    // Try ghost cursor with proper error handling
    try {
      await cursor.click(element);
      logger?.debug("Ghost cursor click successful");
    } catch (cursorError) {
      logger?.debug(
        `Ghost cursor failed: ${cursorError.message}, using fallback`
      );
      // Fallback to direct element click
      if (element && typeof element.click === "function") {
        await element.click();
      } else {
        await page.click(element);
      }
      logger?.debug("Fallback click successful");
    }

    // Small delay after click (natural)
    await sleep(Math.random() * 150 + 50, "after click delay", logger);
  } catch (error) {
    logger?.debug(`Click failed: ${error.message}`);
    throw error;
  }
}

/**
 * Enhanced ghost cursor move with proper fallback
 * @param {Object} cursor - Ghost cursor instance
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Object} page - Page instance for fallback
 * @param {Object} logger - Logger instance
 */
async function _humanLikeMove(cursor, x, y, page, logger = null) {
  try {
    if (!cursor || typeof cursor.move !== "function") {
      throw new Error("No valid cursor available");
    }

    // Try ghost cursor move
    try {
      await cursor.move({ x, y });
      logger?.debug(`Ghost cursor moved to (${x}, ${y})`);
    } catch (cursorError) {
      logger?.debug(
        `Ghost cursor move failed: ${cursorError.message}, using fallback`
      );
      // Fallback to page.mouse.move
      await page.mouse.move(x, y);
      logger?.debug(`Fallback mouse movement to (${x}, ${y}) completed`);
    }
  } catch (error) {
    logger?.debug(`Mouse movement failed: ${error.message}`);
    throw error;
  }
}

/**
 * Perform safe cursor movements with error handling
 * @param {Object} page - Puppeteer page
 * @param {Object} cursor - Ghost cursor
 * @param {Object} logger - Winston logger instance
 * @param {Number} movementCount - Number of movements to perform (default: 5)
 * @param {boolean} disableMovements - Whether to skip movements entirely
 * @returns {Promise<void>}
 */
async function performSafeCursorMovements(page, cursor, logger = null, movementCount = 5, disableMovements = false) {
  try {
    if (disableMovements) {
      logger?.debug("Random mouse movements disabled - skipping cursor movements");
      return;
    }

    if (!page || !cursor) {
      logger?.debug("Cannot perform cursor movements: page or cursor is null");
      return;
    }

    // Check if page is still valid before proceeding
    try {
      const pageUrl = await page.url();
      logger?.debug(`Performing cursor movements on ${pageUrl}`);
    } catch (error) {
      logger?.debug("Cannot perform cursor movements: page is no longer valid");
      return;
    }

    await _performRandomMouseMovements(page, cursor, logger, movementCount);
  } catch (error) {
    logger?.debug("Error during safe cursor movements", {
      error: error.message,
    });
  }
}

/**
 * Perform random mouse movements
 * @private
 */
async function _performRandomMouseMovements(page, cursor, logger = null, movementCount = 5) {
  try {
    const viewport = await page.viewport();
    const maxX = Math.min(viewport?.width || 1366, 1366) - 100;
    const maxY = Math.min(viewport?.height || 768, 768) - 100;

    // Use provided movementCount or fallback to 4-6 random movements
    const actualMovementCount = movementCount || Math.floor(Math.random() * 3) + 4;

    for (let i = 0; i < actualMovementCount; i++) {
      // Generate safe coordinates (avoid top and edges where buttons might be)
      const targetX = Math.random() * (maxX - 400) + 200; // More conservative bounds
      const targetY = Math.random() * (maxY - 300) + 150; // Avoid header area

      try {
        // Check if the target area is safe (not over clickable elements)
        const isSafeArea = await page.evaluate(
          (x, y) => {
            const element = document.elementFromPoint(x, y);
            if (!element) return true;

            // Avoid moving over links, buttons, or other clickable elements
            const tagName = element.tagName.toLowerCase();
            const hasClickHandler =
              element.onclick ||
              element.getAttribute("onclick") ||
              element.hasAttribute("data-ved") ||
              element.hasAttribute("href");

            const isClickable =
              ["a", "button", "input", "select"].includes(tagName) ||
              hasClickHandler ||
              element.role === "button" ||
              element.role === "link";

            // Stay in safe text areas or empty spaces
            return !isClickable;
          },
          targetX,
          targetY
        );

        if (!isSafeArea) {
          logger?.debug(
            `Skipping unsafe movement target (${targetX}, ${targetY})`
          );
          continue;
        }

        // Use our enhanced move function with timeout protection
        await Promise.race([
          _humanLikeMove(cursor, targetX, targetY, page, logger),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Movement timeout")), 3000)
          )
        ]);
        
        logger?.debug(`Random movement ${i + 1} completed`);

        // Pause before next movement
        await sleep(
          Math.random() * 1000 + 500,
          `random movement pause ${i + 1}`,
          logger
        );
      } catch (moveError) {
        logger?.debug(`Random movement ${i + 1} failed: ${moveError.message}`);
        continue;
      }
    }
  } catch (error) {
    logger?.debug("Error in random mouse movements", { error: error.message });
  }
}

/**
 * Launch browser with real browser configuration using puppeteer-real-browser
 * @param {Object} config - Configuration object
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<Object>} Browser instance
 */
async function launchBrowser(config, logger = null) {
  try {
    logger?.info("Launching browser instance");

    const isHeadless = config.headless === true;
    
    if (isHeadless) {
      logger?.info("Using enhanced stealth headless configuration");
    } else {
      logger?.info("Using visible browser with anti-detection configuration");
    }

    // Enhanced browser arguments for better stealth
    const browserArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=TranslateUI",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-translate",
      "--no-default-browser-check",
      "--no-pings",
      "--password-store=basic",
      "--use-mock-keychain",
      // Enhanced anti-detection
      "--disable-blink-features=AutomationControlled",
      "--disable-features=UserAgentClientHint",
      "--allow-running-insecure-content",
      "--ignore-certificate-errors",
      "--ignore-ssl-errors",
      "--ignore-certificate-errors-spki-list",
      "--window-size=1366,768",
      // Enable rendering for proper page display
      "--enable-webgl",
      "--enable-accelerated-2d-canvas",
      "--enable-gpu-rasterization",
      "--force-color-profile=srgb",
      // Additional stealth args
      "--disable-infobars",
      "--disable-notifications",
      "--disable-popup-blocking",
      "--disable-extensions",
      "--disable-component-extensions-with-background-pages",
      "--disable-ipc-flooding-protection",
      "--enable-features=NetworkService,NetworkServiceInProcess",
      "--font-render-hinting=none",
      "--hide-scrollbars",
      "--mute-audio",
    ];

    // Add proxy configuration if available
    if (config.proxyConfig) {
      browserArgs.push(
        `--proxy-server=${config.proxyConfig.type}://${config.proxyConfig.host}:${config.proxyConfig.port}`
      );
    }

    // Use a realistic user agent
    const realisticUserAgents = [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36 Edg/118.0.2088.76",
    ];
    
    const selectedUserAgent = realisticUserAgents[Math.floor(Math.random() * realisticUserAgents.length)];
    browserArgs.push(`--user-agent=${selectedUserAgent}`);

    // Enhanced headless configuration
    const headlessMode = isHeadless ? "new" : false;
    
    // Use puppeteer-real-browser for a real browser instance
    const { browser, page } = await connect({
      headless: headlessMode,
      args: browserArgs,
      turnstile: true,
      disableXvfb: false,
      ignoreHTTPSErrors: true,
      customConfig: {
        // Add additional stealth configurations
        defaultViewport: null, // Use default viewport of the browser
      },
      connectOption: {
        ignoreDefaultArgs: ["--enable-automation"],
        defaultViewport: {
          width: 1366,
          height: 768,
        },
      },
    });

    browserInstance = browser;

    // Get the actual user agent from the real browser
    const actualUserAgent = await page.evaluate(() => navigator.userAgent);

    logger?.info("Browser launched successfully", {
      headless: config.headless,
      userAgent: actualUserAgent,
      viewport: { width: 1366, height: 768 },
    });

    return { browser, firstPage: page };
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
 * @param {Object} firstPage - Optional first page from real browser
 * @returns {Promise<Object>} Page instance with cursor
 */
async function createPage(browser, config, logger = null, firstPage = null) {
  try {
    // Use the first page if provided (from puppeteer-real-browser), otherwise create new
    const page = firstPage || (await browser.newPage());
    pageInstance = page;

    // Enhanced stealth mode configuration
    await page.evaluateOnNewDocument(() => {
      // Advanced webdriver removal
      delete Object.getPrototypeOf(navigator).webdriver;
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        enumerable: false,
        configurable: false
      });

      // Mock more realistic navigator properties
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en", "es"],
      });

      // Mock realistic plugins array
      const mockPlugins = [
        { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
        { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "Portable Document Format" },
        { name: "Native Client", filename: "internal-nacl-plugin", description: "Native Client Executable" }
      ];
      
      Object.defineProperty(navigator, "plugins", {
        get: () => {
          const plugins = mockPlugins.map(plugin => {
            const pluginObj = { name: plugin.name, filename: plugin.filename, description: plugin.description };
            Object.defineProperty(pluginObj, "length", { value: 1 });
            Object.defineProperty(pluginObj, "item", { value: () => pluginObj });
            return pluginObj;
          });
          
          // Add array-like properties
          plugins.item = idx => plugins[idx];
          plugins.namedItem = name => plugins.find(plugin => plugin.name === name);
          Object.defineProperty(plugins, "length", { value: plugins.length });
          
          return plugins;
        },
        enumerable: true,
        configurable: false
      });

      // Mock Chrome-specific properties
      window.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {},
      };

      // Mock permissions
      const originalQuery = window.navigator.permissions?.query;
      if (originalQuery) {
        window.navigator.permissions.query = (parameters) => {
          // Use parameters to determine the response
          if (parameters && parameters.name === 'notifications') {
            return Promise.resolve({ state: "prompt", onchange: null });
          }
          return Promise.resolve({ state: "granted", onchange: null });
        };
      }

      // Better iframe handling
      window.solveSimpleChallenge = function (challengeType) {
        console.log("Simple challenge handler called:", challengeType);
        return true;
      };

      // Mock Google's internal objects to prevent CQ errors
      window.google = window.google || {};
      window.google.search = window.google.search || {};
      window.google.search.CQ = window.google.search.CQ || {};
      window.google.search.csi = window.google.search.csi || {};

      // Mock mobile search objects
      window.mhp_ = window.mhp_ || {};
      window.mhp_.CQ = window.mhp_.CQ || {};
      window.mhp_.Qz =
        window.mhp_.Qz ||
        function () {
          return {};
        };
      window.mhp_0td =
        window.mhp_0td ||
        function () {
          return {};
        };

      // Override console methods to suppress Google's internal errors
      const originalConsoleError = console.error;
      const originalConsoleWarn = console.warn;

      console.error = function (...args) {
        const message = args.join(" ");
        // Suppress Google's internal script errors
        if (
          message.includes(
            "Cannot read properties of undefined (reading 'CQ')"
          ) ||
          message.includes("mhp_") ||
          message.includes("sb_mobh") ||
          message.includes("hjsa") ||
          message.includes("TypeError: Cannot read properties of undefined") ||
          message.includes("google.search") ||
          message.includes("mobile search")
        ) {
          return; // Suppress these errors
        }
        return originalConsoleError.apply(console, args);
      };

      console.warn = function (...args) {
        const message = args.join(" ");
        if (
          (message.includes("iframe") && message.includes("sandbox")) ||
          message.includes("mhp_") ||
          message.includes("sb_mobh")
        ) {
          return; // Suppress iframe sandbox warnings and mobile search warnings
        }
        return originalConsoleWarn.apply(console, args);
      };

      // Suppress uncaught exceptions from Google's scripts
      window.addEventListener(
        "error",
        function (event) {
          const message = event.message || "";
          const filename = event.filename || "";

          if (
            message.includes(
              "Cannot read properties of undefined (reading 'CQ')"
            ) ||
            message.includes("mhp_") ||
            filename.includes("sb_mobh") ||
            filename.includes("hjsa") ||
            message.includes("google.search")
          ) {
            event.preventDefault();
            event.stopPropagation();
            return false;
          }
        },
        true
      );

      // Enhance iframe security handling
      const originalCreateElement = document.createElement;
      document.createElement = function (tagName) {
        const element = originalCreateElement.call(document, tagName);
        if (tagName.toLowerCase() === "iframe") {
          // Better sandbox attribute handling
          const originalSetAttribute = element.setAttribute;
          element.setAttribute = function (name, value) {
            if (name === "sandbox") {
              // Modify sandbox to be more secure while allowing functionality
              const safeSandbox = value
                .replace(/allow-same-origin/g, "")
                .replace(/allow-scripts/g, "allow-scripts")
                .trim();
              return originalSetAttribute.call(
                this,
                name,
                safeSandbox + " allow-forms"
              );
            }
            return originalSetAttribute.call(this, name, value);
          };
        }
        return element;
      };
      
      // Mock WebGL fingerprinting
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        // UNMASKED_VENDOR_WEBGL
        if (parameter === 37445) {
          return 'Google Inc. (Intel)';
        }
        // UNMASKED_RENDERER_WEBGL
        if (parameter === 37446) {
          return 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';
        }
        return getParameter.apply(this, arguments);
      };
    });

    // Set a realistic viewport size with variation
    const viewportWidth = 1366 + Math.floor(Math.random() * 100);
    const viewportHeight = 768 + Math.floor(Math.random() * 50);
    await page.setViewport({ 
      width: viewportWidth, 
      height: viewportHeight,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: true,
      isMobile: false
    });

    // Improve page performance and security
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const resourceType = request.resourceType();
      const url = request.url();

      // Allow essential resources for proper page rendering
      if (
        resourceType === "stylesheet" ||
        resourceType === "document" ||
        resourceType === "script" ||
        resourceType === "font" ||
        url.includes("recaptcha") ||
        url.includes("gstatic") ||
        url.includes("google.com") ||
        url.includes("googleusercontent.com") ||
        url.includes("googleapis.com")
      ) {
        request.continue();
      } else if (resourceType === "image") {
        // Allow some images for proper rendering, but limit size
        if (config.loadImages !== false) {
          request.continue();
        } else {
          request.abort();
        }
      } else if (resourceType === "media" || resourceType === "other") {
        // Block media and other non-essential resources
        request.abort();
      } else {
        request.continue();
      }
    });

    // Handle console errors and warnings
    page.on("console", (msg) => {
      const text = msg.text();

      // Ignore various Google internal errors and warnings
      if (
        (text.includes("iframe") && text.includes("sandbox")) ||
        text.includes("Cannot read properties of undefined (reading 'CQ')") ||
        text.includes("mhp_") ||
        text.includes("sb_mobh") ||
        text.includes("hjsa") ||
        text.includes("google.search") ||
        text.includes("mobile search") ||
        text.includes("net::ERR_BLOCKED_BY_CLIENT") ||
        text.includes("Failed to load resource") ||
        text.includes("status of 429") ||
        text.includes("status of 404") ||
        text.includes("the server responded with a status") ||
        text.includes("net::ERR_") ||
        text.includes("403 (Forbidden)") ||
        text.includes("429 (Too Many Requests)")
      ) {
        // Ignore these common Google internal errors and HTTP status errors
        return;
      }

      if (msg.type() === "error") {
        logger?.debug("Page console error:", text);
      }
    });

    // Handle page errors gracefully
    page.on("pageerror", (error) => {
      const errorMessage = error.message || "";

      // Ignore Google's internal script errors
      if (
        errorMessage.includes("solveSimpleChallenge") ||
        errorMessage.includes(
          "Cannot read properties of undefined (reading 'CQ')"
        ) ||
        errorMessage.includes("mhp_") ||
        errorMessage.includes("sb_mobh") ||
        errorMessage.includes("hjsa") ||
        errorMessage.includes("google.search")
      ) {
        return; // Ignore these errors
      }

      logger?.debug("Page error:", errorMessage);
    });

    // Set proxy authentication if needed
    if (config.proxyConfig?.username && config.proxyConfig?.password) {
      await page.authenticate({
        username: config.proxyConfig.username,
        password: config.proxyConfig.password,
      });
    }

    // Create ghost cursor for human-like interactions with error handling
    let cursor = null;
    try {
      cursor = createCursor(page);

      // Test cursor functionality immediately
      const testResult = await page.evaluate(() => {
        return {
          width: window.innerWidth,
          height: window.innerHeight,
          ready: true,
        };
      });

      if (testResult.ready) {
        logger?.debug("Ghost cursor initialized successfully");
      }
    } catch (cursorError) {
      logger?.warn(
        "Ghost cursor initialization failed, will use fallback methods",
        {
          error: cursorError.message,
        }
      );
      cursor = null; // Set to null to trigger fallback methods
    }

    logger?.info("Page created with anti-detection measures");
    return { page, cursor };
  } catch (error) {
    logger?.error("Failed to create page", { error: error.message });
    throw error;
  }
}

/**
 * Check for consent forms dynamically and handle them
 * @param {Object} page - Puppeteer page
 * @param {Object} cursor - Ghost cursor
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<boolean>} True if consent was found and handled
 */
async function _checkAndHandleConsentDynamic(page, cursor, logger = null) {
  try {
    // Quick check for consent indicators without waiting
    const consentInfo = await page.evaluate(() => {
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
      const currentUrl = window.location.href;

      // Check for search box (indicates main Google page)
      const hasSearchBox = !!(
        document.querySelector('input[name="q"]') ||
        document.querySelector('textarea[name="q"]') ||
        document.querySelector("#APjFqb") ||
        document.querySelector(".RNNXgb")
      );

      const foundIndicators = indicators.filter(
        (indicator) =>
          pageText.includes(indicator) ||
          pageHTML.includes(indicator) ||
          currentUrl.includes("consent.google")
      );

      return {
        isConsentPage: foundIndicators.length > 0 && !hasSearchBox,
        hasSearchBox,
        foundIndicators,
        url: currentUrl,
        title: document.title,
      };
    });

    logger?.debug("Consent check results:", consentInfo);

    if (consentInfo.isConsentPage) {
      logger?.info("Dynamic consent form detected during warmup, handling...");
      const handled = await handleConsentOptimized(page, cursor, logger);
      return handled;
    }

    if (consentInfo.hasSearchBox) {
      logger?.debug("Search box detected - already on main Google page");
      return false;
    }

    return false;
  } catch (error) {
    logger?.debug("Error checking for dynamic consent:", {
      error: error.message,
    });
    return false;
  }
}

/**
 * Perform warm-up browsing session with dynamic consent monitoring
 * @param {Object} pageData - Page and cursor data
 * @param {Object} logger - Winston logger instance
 */
async function performWarmup(pageData, logger = null) {
  const { page, cursor, dashboard } = pageData;

  try {
    logger?.info("Starting warm-up browsing session");
    logWithDedup("info", "🔥 Starting warm-up session...", chalk.blue, logger);

    // Update dashboard status
    if (dashboard && dashboard.setStatus) {
      dashboard.setStatus("warming-up");
    }
    if (dashboard && dashboard.addLog) {
      dashboard.addLog("info", "🔥 Starting warm-up browsing session...");
    }

    // Generate warm-up time (30-60 seconds maximum, capped at 60s)
    const warmupTime = Math.min(
      Math.floor(Math.random() * 30000) + 30000,
      60000
    );

    const warmupSeconds = Math.ceil(warmupTime / 1000);
    logger?.info(`Warm-up session duration: ${warmupTime}ms (${warmupSeconds}s)`);

    // Update dashboard with countdown
    if (dashboard && dashboard.addLog) {
      dashboard.addLog("info", `🔥 Starting ${warmupSeconds}s warm-up session with countdown...`);
    }

    // Navigate to Google with proper loading detection
    await navigateToGoogle(pageData, logger);

    // Handle initial consent if present (ONLY ONCE)
    await handleConsentOptimized(page, cursor, logger);

    // NO INTERVAL - NO CLICKING - ONLY CURSOR MOVEMENTS
    logger?.info("Performing MOVEMENT-ONLY warmup - no clicking allowed");

    // Warmup with ONLY cursor movements on Google homepage
    const warmupStartTime = Date.now();
    const warmupEndTime = warmupStartTime + warmupTime;

    // Start countdown timer
    let lastCountdownTime = warmupSeconds;
    logger?.info(`⏱️ Warm-up countdown: ${lastCountdownTime}s remaining`);
    
    if (dashboard && dashboard.addLog) {
      dashboard.addLog("info", `⏱️ Warm-up countdown: ${lastCountdownTime}s remaining`);
    }
    
    // Send initial countdown status to dashboard
    if (dashboard && dashboard.setProcessingStatus) {
      dashboard.setProcessingStatus(`🔥 Warming up: ${lastCountdownTime}s remaining`);
    }

    // Temporarily disable all pointer events so hover/click handlers cannot trigger navigation
    await page.evaluate(() => {
      if (!document.body.dataset.pointerEventsDisabled) {
        document.body.dataset.pointerEventsDisabled = 'true';
        document.body.dataset.prevPointerEvents = document.body.style.pointerEvents || '';
        document.body.style.pointerEvents = 'none';
      }
    });

    // Stay on Google homepage and ONLY move cursor
    while (Date.now() < warmupEndTime) {
      // Update countdown every second
      const remainingTime = Math.ceil((warmupEndTime - Date.now()) / 1000);
      if (remainingTime !== lastCountdownTime && remainingTime > 0) {
        lastCountdownTime = remainingTime;
        logger?.debug(`⏱️ Warm-up countdown: ${remainingTime}s remaining`);
        
        // Update dashboard with countdown every second
        if (dashboard && dashboard.setProcessingStatus) {
          dashboard.setProcessingStatus(`🔥 Warming up: ${remainingTime}s remaining`);
        }
        
        // Log to dashboard (every 5 seconds to avoid spam)
        if (remainingTime % 5 === 0 && dashboard && dashboard.addLog) {
          dashboard.addLog("info", `⏱️ Warm-up countdown: ${remainingTime}s remaining`);
        }
      }

      // Verify we're still on Google (don't navigate if we're not)
      const currentUrl = page.url();
      if (!currentUrl.includes("google.com")) {
        logger?.warn(
          `⚠️ Navigated away from Google during warmup to: ${currentUrl}`
        );
        logger?.info("🔄 Returning to Google homepage");

        // Go back to Google homepage
        await page.goto("https://www.google.com", {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await waitForPageReady(page, "google", true, logger);

        // Handle consent if needed after returning
        await handleConsentOptimized(page, cursor, logger);
      }

      // Perform ONLY safe cursor movements (absolutely NO clicking or interaction)
      logger?.debug("Performing MOVEMENT-ONLY warmup - no interactions");
      
      // Check if movements are disabled via pageData config
      const disableMovements = pageData.config?.disableMovements || false;
      await performSafeCursorMovements(page, cursor, logger, 5, disableMovements);

      // Pause between movement sessions (shorter pause if movements disabled)
      const pauseTime = disableMovements ? 
        Math.random() * 1000 + 500 : // 0.5-1.5 seconds if movements disabled
        Math.random() * 3000 + 2000; // 2-5 seconds normally
      await sleep(pauseTime, "warmup movement pause", logger);
    }

    // Restore pointer events after warm-up cursor movements finish
    await page.evaluate(() => {
      if (document.body.dataset.pointerEventsDisabled) {
        document.body.style.pointerEvents = document.body.dataset.prevPointerEvents || '';
        delete document.body.dataset.pointerEventsDisabled;
        delete document.body.dataset.prevPointerEvents;
      }
    });

    logWithDedup("info", "✅ Warm-up session completed", chalk.green, logger);
    logger?.info("Warm-up session completed successfully (movement-only)");
    
    // Clear countdown status
    if (dashboard && dashboard.setProcessingStatus) {
      dashboard.setProcessingStatus(null);
    }
    
    // Final countdown completion message
    if (dashboard && dashboard.addLog) {
      dashboard.addLog("success", `✅ Warm-up countdown completed! Ready for dorking.`);
    }
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
 * Optimized consent handling with better detection and limits
 * @param {Object} page - Puppeteer page
 * @param {Object} cursor - Ghost cursor
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<boolean>} True if consent was handled successfully
 */
async function handleConsentOptimized(page, cursor, logger = null) {
  try {
    logger?.info("Starting optimized consent handling...");

    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      logger?.debug(`Consent handling attempt ${attempt}/${maxAttempts}`);

      // Wait for page to stabilize and consent elements to be ready
      await waitForPageReady(page, "google", true, logger);

      // Check if we're actually on a consent page and get current state
      const pageState = await page.evaluate(() => {
        const currentUrl = window.location.href;
        const pageText = document.body.textContent || "";

        // Strong indicators we're on main Google page (not consent)
        const hasSearchBox = !!(
          document.querySelector('input[name="q"]') ||
          document.querySelector('textarea[name="q"]') ||
          document.querySelector("#APjFqb") ||
          document.querySelector(".RNNXgb")
        );

        const hasGoogleLogo = !!document.querySelector(
          '[aria-label*="Google"]'
        );

        // Consent page indicators
        const consentIndicators = [
          "Before you continue to Google",
          "We use cookies and data",
          "Accept all",
          "Reject all",
          "I agree",
          "cookies and data to",
          "consent.google.com",
          "personalized ads and content",
          "measurement and audience insights",
          "Your privacy, your choice"
        ];

        const hasConsentText = consentIndicators.some((indicator) =>
          pageText.includes(indicator)
        );

        // Find clickable consent elements
        const consentButtons = Array.from(
          document.querySelectorAll('button, div[role="button"], input[type="submit"]')
        ).filter((el) => {
          const text = (
            el.textContent ||
            el.getAttribute("aria-label") ||
            el.value ||
            ""
          ).toLowerCase();
          return (
            text.includes("accept all") ||
            text.includes("accept") ||
            text.includes("agree") ||
            text.includes("i agree") ||
            el.id === "L2AGLb" ||
            el.getAttribute("jsname") === "higCR" ||
            el.getAttribute("jsname") === "tWT92d"
          );
        });

        return {
          url: currentUrl,
          title: document.title,
          hasSearchBox,
          hasGoogleLogo,
          hasConsentText,
          isMainGooglePage: hasSearchBox && hasGoogleLogo && !hasConsentText,
          consentButtonCount: consentButtons.length,
          consentButtons: consentButtons.map((btn) => ({
            tagName: btn.tagName,
            id: btn.id,
            text: (btn.textContent || "").substring(0, 50),
            role: btn.getAttribute("role"),
          })),
        };
      });

      logger?.debug(`Page state on attempt ${attempt}:`, pageState);
      
      // Log more details about consent detection
      if (pageState.hasConsentText && pageState.consentButtonCount > 0) {
        logger?.info(`Consent page detected with ${pageState.consentButtonCount} consent buttons`);
        pageState.consentButtons.forEach((btn, index) => {
          logger?.debug(`Consent button ${index + 1}: ${btn.tagName} id="${btn.id}" text="${btn.text}" role="${btn.role}"`);
        });
      } else if (pageState.hasConsentText) {
        logger?.warn("Consent text detected but no consent buttons found");
      } else if (pageState.consentButtonCount > 0) {
        logger?.info(`Found ${pageState.consentButtonCount} potential consent buttons but no consent text`);
      }

      // If we're already on main Google page, no consent handling needed
      if (pageState.isMainGooglePage) {
        logger?.info("Already on main Google page - consent handling complete");
        return true;
      }

      // If no consent elements found, might not be a consent page
      if (pageState.consentButtonCount === 0) {
        logger?.info("No consent elements found - proceeding");
        return true;
      }

      // Try to click consent buttons
      const success = await clickConsentButtons(page, cursor, logger);
      if (success) {
        // Wait for navigation/page update
        await waitForConsentHandled(page, logger, 5000);

        // Verify we moved past consent
        const newState = await page.evaluate(() => {
          const hasSearchBox = !!(
            document.querySelector('input[name="q"]') ||
            document.querySelector('textarea[name="q"]') ||
            document.querySelector("#APjFqb") ||
            document.querySelector(".RNNXgb")
          );
          return { hasSearchBox, url: window.location.href };
        });

        if (newState.hasSearchBox) {
          logger?.info(
            "Consent successfully handled - search box now available"
          );
          return true;
        }
      }
    }

    logger?.warn("Could not handle consent after maximum attempts");
    return false;
  } catch (error) {
    logger?.error("Error in optimized consent handling", {
      error: error.message,
    });
    return false;
  }
}

/**
 * Click consent buttons with improved reliability and correct button selection
 * @param {Object} page - Puppeteer page
 * @param {Object} cursor - Ghost cursor
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<boolean>} True if a button was successfully clicked
 */
async function clickConsentButtons(page, cursor, logger = null) {
  try {
    // First, try the most specific and reliable selectors
    const prioritySelectors = [
      // Most common Google consent button ID - highest priority
      'button[id="L2AGLb"]',
      // Google-specific jsname selectors for Accept All
      'button[jsname="higCR"]',
      'button[jsname="tWT92d"]',
    ];

    // Try priority selectors first
    for (const selector of prioritySelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          // Validate this is actually an accept button
          const buttonInfo = await page.evaluate((el) => {
            const text = (el.textContent || el.value || el.getAttribute("aria-label") || "").toLowerCase();
            const isAcceptButton = text.includes("accept all") || text.includes("i agree") || 
                                 text.includes("accept") || el.id === "L2AGLb" ||
                                 el.getAttribute("jsname") === "higCR" ||
                                 el.getAttribute("jsname") === "tWT92d";
            const isRejectButton = text.includes("reject") || text.includes("decline") || 
                                 text.includes("no thanks") || text.includes("manage");
            
            return {
              text: text,
              isAcceptButton: isAcceptButton,
              isRejectButton: isRejectButton,
              id: el.id,
              jsname: el.getAttribute("jsname")
            };
          }, element);

          if (buttonInfo.isAcceptButton && !buttonInfo.isRejectButton) {
            logger?.info(`Found priority consent button: ${selector} - "${buttonInfo.text}"`);
            return await clickConsentElement(element, page, cursor, logger, selector);
          } else {
            logger?.debug(`Skipping priority selector ${selector} - not a valid accept button: "${buttonInfo.text}"`);
          }
        }
      } catch (error) {
        logger?.debug(`Error with priority selector ${selector}: ${error.message}`);
      }
    }

    // If priority selectors failed, try text-based selectors with better filtering
    const textBasedSelectors = [
      { selector: 'button', text: 'accept all', exact: true },
      { selector: 'div[role="button"]', text: 'accept all', exact: true },
      { selector: 'input[type="submit"]', text: 'accept all', exact: true },
      { selector: 'button', text: 'i agree', exact: true },
      { selector: 'button', text: 'accept', exact: false },
    ];

    for (const selectorConfig of textBasedSelectors) {
      try {
        const elements = await page.evaluateHandle((config) => {
          const elements = Array.from(document.querySelectorAll(config.selector));
          return elements.filter((el) => {
            const text = (el.textContent || el.value || el.getAttribute("aria-label") || "").toLowerCase().trim();
            
            // Check if text matches our target
            const matchesTarget = config.exact 
              ? text === config.text || text.includes(config.text)
              : text.includes(config.text);
            
            if (!matchesTarget) return false;
            
            // Exclude reject/decline buttons
            const isRejectButton = text.includes("reject") || text.includes("decline") || 
                                 text.includes("no thanks") || text.includes("manage") ||
                                 text.includes("refuse") || text.includes("deny");
            
            // For non-exact matches, be more strict about accept buttons
            if (!config.exact) {
              const isValidAccept = text.includes("accept all") || text.includes("accept") || 
                                  text.includes("agree") || text.includes("allow");
              return isValidAccept && !isRejectButton;
            }
            
            return !isRejectButton;
          });
        }, selectorConfig);

        const elementArray = await page.evaluate((els) => 
          Array.from(els).map(el => ({
            text: (el.textContent || el.value || el.getAttribute("aria-label") || "").toLowerCase().trim(),
            id: el.id,
            className: el.className
          }))
        , elements);

        if (elementArray.length > 0) {
          logger?.info(`Found ${elementArray.length} text-based consent buttons for "${selectorConfig.text}"`);
          elementArray.forEach((btn, idx) => {
            logger?.debug(`Text button ${idx + 1}: "${btn.text}" (id: ${btn.id})`);
          });

          // Get the first valid element
          const firstElement = await page.evaluateHandle((config) => {
            const elements = Array.from(document.querySelectorAll(config.selector));
            return elements.find((el) => {
              const text = (el.textContent || el.value || el.getAttribute("aria-label") || "").toLowerCase().trim();
              const matchesTarget = config.exact 
                ? text === config.text || text.includes(config.text)
                : text.includes(config.text);
              
              if (!matchesTarget) return false;
              
              const isRejectButton = text.includes("reject") || text.includes("decline") || 
                                   text.includes("no thanks") || text.includes("manage") ||
                                   text.includes("refuse") || text.includes("deny");
              
              if (!config.exact) {
                const isValidAccept = text.includes("accept all") || text.includes("accept") || 
                                    text.includes("agree") || text.includes("allow");
                return isValidAccept && !isRejectButton;
              }
              
              return !isRejectButton;
            });
          }, selectorConfig);

          const exists = await page.evaluate((el) => !!el, firstElement);
          if (exists) {
            return await clickConsentElement(firstElement, page, cursor, logger, `${selectorConfig.selector}:text("${selectorConfig.text}")`);
          }
        }
      } catch (error) {
        logger?.debug(`Error with text selector ${selectorConfig.selector}:"${selectorConfig.text}": ${error.message}`);
      }
    }

    // Final fallback - try attribute-based selectors
    const attributeSelectors = [
      'button[aria-label*="Accept all"]',
      'button[aria-label*="I agree"]',
      'input[type="submit"][value*="Accept all"]',
      'form[action*="consent"] button:first-child',
      '.saveButtonContainer button:last-child',
      '.saveButtonContainer input[type="submit"]:last-child',
    ];

    for (const selector of attributeSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          // Validate this is not a reject button
          const buttonInfo = await page.evaluate((el) => {
            const text = (el.textContent || el.value || el.getAttribute("aria-label") || "").toLowerCase();
            const isRejectButton = text.includes("reject") || text.includes("decline") || 
                                 text.includes("no thanks") || text.includes("manage");
            return {
              text: text,
              isRejectButton: isRejectButton
            };
          }, element);

          if (!buttonInfo.isRejectButton) {
            logger?.info(`Found attribute-based consent button: ${selector} - "${buttonInfo.text}"`);
            return await clickConsentElement(element, page, cursor, logger, selector);
          } else {
            logger?.debug(`Skipping attribute selector ${selector} - appears to be reject button: "${buttonInfo.text}"`);
          }
        }
      } catch (error) {
        logger?.debug(`Error with attribute selector ${selector}: ${error.message}`);
      }
    }

    logger?.warn("No valid consent buttons found with any selector");
    return false;
  } catch (error) {
    logger?.error("Error clicking consent buttons", { error: error.message });
    return false;
  }
}

/**
 * Helper function to click a consent element with proper error handling
 * @param {Object} element - Element to click
 * @param {Object} page - Puppeteer page
 * @param {Object} cursor - Ghost cursor
 * @param {Object} logger - Logger instance
 * @param {string} selector - Selector used to find the element
 * @returns {Promise<boolean>} True if clicked successfully
 */
async function clickConsentElement(element, page, cursor, logger, selector) {
  try {
    logger?.info(`Attempting to click consent element: ${selector}`);

    // Scroll into view
    await page.evaluate((el) => {
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, element);

    // Wait for scroll to complete
    await page.waitForFunction(() => {
      return new Promise(resolve => {
        let lastScrollTop = document.documentElement.scrollTop;
        const checkScroll = () => {
          const currentScrollTop = document.documentElement.scrollTop;
          if (currentScrollTop === lastScrollTop) {
            resolve(true);
          } else {
            lastScrollTop = currentScrollTop;
            setTimeout(checkScroll, 100);
          }
        };
        setTimeout(checkScroll, 100);
      });
    }, { timeout: 2000 }).catch(() => null);

    // Try ghost cursor first, then fallback
    let clicked = false;

    if (cursor && typeof cursor.click === "function") {
      try {
        await Promise.race([
          cursor.click(element),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("cursor timeout")), 5000)
          ),
        ]);
        clicked = true;
        logger?.info("Ghost cursor click successful on consent button");
      } catch (error) {
        logger?.debug(`Ghost cursor failed: ${error.message}`);
      }
    }

    // Fallback to direct click
    if (!clicked) {
      await page.evaluate((el) => {
        if (el && typeof el.click === "function") {
          el.click();
        }
      }, element);
      clicked = true;
      logger?.info("Fallback click successful on consent button");
    }

    if (clicked) {
      await waitForConsentHandled(page, logger, 3000);
      return true;
    }

    return false;
  } catch (error) {
    logger?.error(`Error clicking consent element: ${error.message}`);
    return false;
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
    // Wait for potential consent form to load
    await waitForPageReady(page, "google", true, logger);

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

          // Wait for button to be ready for interaction
          await page.waitForFunction(() => document.readyState === 'complete', { timeout: 1000 }).catch(() => null);
          logger?.debug(
            `Ghost cursor clicking Accept all button on consent.google.com`
          );
          try {
            await cursor.click(acceptButton);
            logger?.debug(`Click completed on Accept all button`);
          } catch (cursorError) {
            logger?.debug(
              `Cursor click failed, using fallback: ${cursorError.message}`
            );
            await page.evaluate((el) => el.click(), acceptButton);
            logger?.debug(`Fallback click completed on Accept all button`);
          }
          await waitForConsentHandled(page, logger, 5000);

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
        logger?.warn("Error handling consent.google.com page:", {
          error: error.message,
        });
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
        // Wait for page to be ready for interaction
        await page.waitForFunction(() => document.readyState === 'complete', { timeout: 1000 }).catch(() => null);

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

          // Wait for element to be ready for interaction
          await page.waitForFunction(() => document.readyState === 'complete', { timeout: 1000 }).catch(() => null);

          // Click using ghost cursor for human-like interaction
          logger?.debug(
            `Ghost cursor clicking consent element with selector: ${selector}`
          );
          try {
            // Enhanced validation for cursor and element before click
            const isValidCursor =
              cursor &&
              typeof cursor === "object" &&
              typeof cursor.click === "function";
            const isValidElement = element && typeof element === "object";

            if (isValidCursor && isValidElement) {
              try {
                await cursor.click(element);
                logger?.debug(`Click completed on consent element`);
              } catch (clickError) {
                // Check if it's a remoteObject error
                if (clickError.message.includes("remoteObject")) {
                  logger?.debug(
                    "Ghost cursor remoteObject error on click, using fallback"
                  );
                  throw new Error("remoteObject not available");
                }
                throw clickError;
              }
            } else {
              throw new Error(
                `Invalid cursor (${isValidCursor}) or element (${isValidElement})`
              );
            }
          } catch (cursorError) {
            logger?.debug(
              `Cursor click failed, using fallback: ${cursorError.message}`
            );
            try {
              // More reliable fallback: direct element click
              await page.evaluate((el) => {
                if (el && typeof el.click === "function") {
                  el.click();
                }
              }, element);
              logger?.debug(`Fallback click completed on consent element`);
            } catch (fallbackError) {
              logger?.debug(
                `Both cursor and fallback click failed: ${fallbackError.message}`
              );
            }
          }

          // Wait for navigation or page change
          await waitForConsentHandled(page, logger, 5000);

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

      await waitForConsentHandled(page, logger, 5000);
      logger?.info("Attempted JavaScript consent handling");
    } catch (jsError) {
      logger?.warn("JavaScript consent handling failed:", {
        error: jsError.message,
      });
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
      // Random human actions (NO CLICKING during warmup to avoid navigating away)
      const actions = ["scroll", "move", "pause", "scroll", "move", "hover"];

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
            // Check if error is due to detached context
            if (
              scrollError.message.includes("detached") ||
              scrollError.message.includes("Target closed") ||
              scrollError.message.includes("Session closed") ||
              scrollError.message.includes("Execution context")
            ) {
              // Page context lost - this is expected sometimes, don't log
            } else {
              logger?.debug("Scroll action failed", {
                error: scrollError.message,
              });
            }
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

            logger?.debug(`Ghost cursor moving to position: (${x}, ${y})`);
            try {
              // Enhanced validation for cursor object and coordinates
              const isValidCursor =
                cursor &&
                typeof cursor === "object" &&
                typeof cursor.move === "function";
              const isValidCoords =
                !isNaN(x) &&
                !isNaN(y) &&
                x >= 0 &&
                y >= 0 &&
                x <= maxX &&
                y <= maxY;

              if (isValidCursor && isValidCoords) {
                // Additional safety check for cursor state with timeout
                try {
                  const movePromise = cursor.move(x, y);
                  const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error("cursor timeout")), 3000);
                  });

                  await Promise.race([movePromise, timeoutPromise]);
                  logger?.debug(`Cursor movement completed successfully`);
                } catch (moveError) {
                  // Check for common cursor errors
                  if (
                    moveError.message.includes("remoteObject") ||
                    moveError.message.includes("timeout") ||
                    moveError.message.includes("Protocol error") ||
                    moveError.message.includes("Session closed")
                  ) {
                    logger?.debug(
                      "Ghost cursor error detected, using fallback"
                    );
                    throw new Error("cursor unavailable");
                  }
                  throw moveError;
                }
              } else {
                throw new Error(
                  `Invalid cursor (${isValidCursor}) or coordinates (${isValidCoords})`
                );
              }
            } catch (cursorError) {
              // Check if error is due to detached context
              if (
                cursorError.message.includes("detached") ||
                cursorError.message.includes("Target closed") ||
                cursorError.message.includes("Session closed") ||
                cursorError.message.includes("Execution context")
              ) {
                // Page context lost - expected, don't log
              } else {
                logger?.debug(`Cursor move failed: ${cursorError.message}`);
                try {
                  // Fallback: use page.mouse.move which is more reliable
                  await page.mouse.move(x, y);
                  logger?.debug(`Fallback mouse movement completed`);
                } catch (fallbackError) {
                  // Check if fallback error is also due to detached context
                  if (
                    fallbackError.message.includes("detached") ||
                    fallbackError.message.includes("Target closed") ||
                    fallbackError.message.includes("Session closed")
                  ) {
                    // Page context lost - expected, don't log
                  } else {
                    logger?.debug(
                      `Both cursor and fallback move failed: ${fallbackError.message}`
                    );
                  }
                }
              }
            }
          } catch (moveError) {
            logger?.debug("Move action failed", { error: moveError.message });
          }
          break;
        }

        case "pause":
          await sleep(1000 + Math.random() * 3000);
          break;

        case "hover": {
          try {
            // Hover over elements to simulate reading without clicking
            const viewport = await page.viewport();
            const maxX = Math.min(viewport?.width || 1366, 1366) - 100;
            const maxY = Math.min(viewport?.height || 768, 768) - 100;

            const hoverX = Math.random() * (maxX - 200) + 100;
            const hoverY = Math.random() * (maxY - 200) + 100;

            // Just move to the position and pause (simulates hovering over content)
            try {
              if (cursor && typeof cursor.move === "function") {
                await cursor.move(hoverX, hoverY);
              } else {
                await page.mouse.move(hoverX, hoverY);
              }

              // Pause as if reading content
              await sleep(500 + Math.random() * 1500);
            } catch (hoverError) {
              logger?.debug("Hover simulation failed", {
                error: hoverError.message,
              });
            }
          } catch (hoverError) {
            logger?.debug("Hover action failed", { error: hoverError.message });
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
 * Check if page has loaded properly (not white/blank)
 * @param {Object} page - Puppeteer page
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<boolean>} True if page loaded properly
 */

/**
 * Wait for consent elements to disappear or page to be ready
 * @param {Object} page - Puppeteer page instance
 * @param {Object} logger - Logger instance
 * @param {number} timeout - Timeout in milliseconds
 */
async function waitForConsentHandled(page, logger = null, timeout = 5000) {
  try {
    // Wait for consent elements to disappear or search elements to appear
    await Promise.race([
      // Wait for search box to appear (indicates consent was handled)
      page.waitForSelector('input[name="q"]', { timeout }),
      page.waitForSelector('#APjFqb', { timeout }),
      page.waitForSelector('.gLFyf', { timeout }),
      // Or wait for consent elements to disappear
      page.waitForFunction(() => {
        const consentText = document.body.textContent || "";
        const hasConsentText = consentText.includes("Before you continue to Google") ||
                              consentText.includes("We use cookies and data") ||
                              consentText.includes("Accept all");
        return !hasConsentText;
      }, { timeout })
    ]).catch(() => null);
    
    logger?.debug("Consent handling wait completed");
  } catch (error) {
    logger?.debug(`Consent handling wait failed: ${error.message}`);
  }
}

/**
 * Wait for page to be ready with engine-specific checks
 * @param {Object} page - Puppeteer page instance
 * @param {string} engine - Search engine name
 * @param {boolean} minimal - Whether to use minimal wait
 * @param {Object} logger - Logger instance
 */
async function waitForPageReady(page, engine, minimal = false, logger = null) {
  try {
    if (minimal) {
      // Just wait for basic DOM readiness
      await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 }).catch(() => null);
      return;
    }

    // Engine-specific readiness checks
    const readinessChecks = {
      google: async () => {
        // Wait for search box or basic Google elements
        await Promise.race([
          page.waitForSelector('input[name="q"]', { timeout: 10000 }),
          page.waitForSelector('#APjFqb', { timeout: 10000 }),
          page.waitForSelector('.gLFyf', { timeout: 10000 })
        ]).catch(() => null);
      },
      bing: async () => {
        // Wait for Bing search box
        await Promise.race([
          page.waitForSelector('#sb_form_q', { timeout: 10000 }),
          page.waitForSelector('input[name="q"]', { timeout: 10000 })
        ]).catch(() => null);
      },
      duckduckgo: async () => {
        // Wait for DuckDuckGo search elements
        await Promise.race([
          page.waitForSelector('#search_form_input_homepage', { timeout: 10000 }),
          page.waitForSelector('#search_form_input', { timeout: 10000 }),
          page.waitForSelector('input[name="q"]', { timeout: 10000 })
        ]).catch(() => null);
      }
    };

    // Run engine-specific check
    if (readinessChecks[engine]) {
      await readinessChecks[engine]();
    }

    // General readiness check
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 }).catch(() => null);
    
    logger?.debug(`Page ready for ${engine}`);
  } catch (error) {
    logger?.debug(`Page readiness check failed for ${engine}: ${error.message}`);
    // Continue anyway - don't block on readiness checks
  }
}

async function isPageLoaded(page, logger = null) {
  try {
    const pageInfo = await page.evaluate(() => {
      const body = document.body;
      const hasContent = body && body.innerHTML.trim().length > 100;
      const hasTitle = document.title && document.title.trim().length > 0;
      const hasGoogleElements =
        document.querySelector('input[name="q"]') ||
        document.querySelector(".RNNXgb") ||
        document.querySelector("#searchform") ||
        document.querySelector('[role="search"]');

      return {
        hasContent,
        hasTitle,
        hasGoogleElements,
        bodyLength: body ? body.innerHTML.length : 0,
        title: document.title,
        url: window.location.href,
      };
    });

    logger?.debug("Page load check:", pageInfo);

    return (
      pageInfo.hasContent && (pageInfo.hasTitle || pageInfo.hasGoogleElements)
    );
  } catch (error) {
    logger?.debug("Error checking page load:", { error: error.message });
    return false;
  }
}

/**
 * Navigate to Google search with human-like behavior and proper loading detection
 * @param {Object} pageData - Page and cursor data
 * @param {Object} logger - Winston logger instance
 */
async function navigateToGoogle(pageData, logger = null) {
  const { page } = pageData;

  try {
    logger?.info("Navigating to Google");

    // Try multiple navigation strategies if needed
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        logger?.debug(`Navigation attempt ${attempt}/3`);

        // Navigate with different wait strategies and increased timeouts
        if (attempt === 1) {
          await page.goto("https://www.google.com", {
            waitUntil: "domcontentloaded",
            timeout: 45000,
          });
        } else if (attempt === 2) {
          await page.goto("https://www.google.com", {
            waitUntil: "networkidle2",
            timeout: 45000,
          });
        } else {
          // Last attempt with minimal wait but longer timeout
          await page.goto("https://www.google.com", {
            waitUntil: "load",
            timeout: 60000,
          });
        }

        // Wait for page to be ready instead of arbitrary sleep
        await waitForPageReady(page, "google", false, logger);

        // Check if page loaded properly
        const pageLoaded = await isPageLoaded(page, logger);

        if (pageLoaded) {
          logger?.info(`Page loaded successfully on attempt ${attempt}`);
          break;
        } else if (attempt < 3) {
          logger?.warn(`Page appears blank on attempt ${attempt}, retrying...`);

          // Try refreshing the page
          await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
          await waitForPageReady(page, "google", true, logger);

          const reloadCheck = await isPageLoaded(page, logger);
          if (reloadCheck) {
            logger?.info("Page loaded after refresh");
            break;
          }
        } else {
          logger?.warn("Page still appears blank after all attempts");

          // Try one final reload
          await page.reload({ waitUntil: "load", timeout: 15000 });
          await waitForPageReady(page, "google", false, logger);
        }
      } catch (navError) {
        logger?.warn(`Navigation attempt ${attempt} failed:`, {
          error: navError.message,
        });
        if (attempt === 3) {
          throw navError;
        }
        await waitForPageReady(page, "google", true, logger);
      }
    }

    // Always check and handle consent after navigation
    await handleConsentOptimized(page, pageData.cursor, logger);

    // Final verification that page is ready
    const finalCheck = await isPageLoaded(page, logger);
    if (!finalCheck) {
      logger?.warn("Page may not have loaded properly, but continuing...");
    }

    // Additional wait to ensure page is ready after consent
    await waitForPageReady(page, "google", true, logger);

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

/**
 * Initialize enhanced ghost cursor with proper error handling
 * @param {Object} page - Puppeteer page instance
 * @param {Object} logger - Logger instance
 * @returns {Object} Enhanced cursor object
 */
async function initializeGhostCursor(page, logger = null) {
  try {
    // Create ghost cursor with proper import
    const { createCursor } = await import("ghost-cursor");
    const cursor = createCursor(page);

    // Verify cursor functionality
    if (
      cursor &&
      typeof cursor.move === "function" &&
      typeof cursor.click === "function"
    ) {
      logger?.debug("Ghost cursor initialized successfully");
      return cursor;
    } else {
      throw new Error(
        "Ghost cursor initialization failed - invalid cursor object"
      );
    }
  } catch (error) {
    logger?.warn(
      `Ghost cursor initialization failed: ${error.message}, using fallback mode`
    );

    // Return a fallback cursor object that uses page.mouse directly
    return {
      move: async (target) => {
        const { x, y } =
          typeof target === "object" ? target : { x: target, y: arguments[1] };
        await page.mouse.move(x, y);
      },
      click: async (element) => {
        if (typeof element === "string") {
          await page.click(element);
        } else if (element && typeof element.click === "function") {
          await element.click();
        } else {
          await page.click(element);
        }
      },
    };
  }
}

export {
  launchBrowser,
  createPage,
  performWarmup,
  handleConsent,
  handleConsentOptimized,
  simulateHumanBrowsing,
  navigateToGoogle,
  isPageLoaded,
  waitForPageReady,
  closeBrowser,
  getCurrentInstances,
  performSafeCursorMovements,
  initializeGhostCursor,
};
