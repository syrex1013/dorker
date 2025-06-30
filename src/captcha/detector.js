import chalk from "chalk";
import { logWithDedup } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";

/**
 * Extract middle 4 words from transcription to avoid noise at beginning/end
 * @param {string} text - Original transcription text
 * @param {Object} logger - Winston logger instance
 * @returns {string|null} Cleaned text with middle 4 words or null if not enough words
 */
function extractMiddleFourWords(text, logger = null) {
  try {
    if (!text || typeof text !== "string") {
      return null;
    }

    // Clean the text and split into words
    const cleanedText = text
      .replace(/[()]/g, "") // Remove parentheses
      .replace(/\[.*?\]/g, "") // Remove content in square brackets
      .replace(/\s+/g, " ") // Normalize whitespace
      .trim();

    const words = cleanedText.split(" ").filter(
      (word) =>
        word.length > 0 &&
        !/^[\W_]+$/.test(word) && // Filter out words that are only symbols/punctuation
        !word.toLowerCase().includes("static") &&
        !word.toLowerCase().includes("noise")
    );

    logger?.debug("Word extraction analysis", {
      originalText: text,
      cleanedText: cleanedText,
      totalWords: words.length,
      words: words,
    });

    if (words.length < 4) {
      logger?.debug("Not enough clean words found", {
        wordsFound: words.length,
        words: words,
      });
      return null;
    }

    // Extract middle 4 words
    const startIndex = Math.floor((words.length - 4) / 2);
    const middleFourWords = words.slice(startIndex, startIndex + 4);
    const result = middleFourWords.join(" ");

    logger?.debug("Middle word extraction", {
      startIndex: startIndex,
      extractedWords: middleFourWords,
      result: result,
    });

    return result;
  } catch (error) {
    logger?.error("Error extracting middle words", {
      error: error.message,
      text: text,
    });
    return null;
  }
}

/**
 * Attempt transcription using ElevenLabs API (using proper SDK)
 * @param {string} audioFilePath - Path to audio file
 * @param {string} apiKey - ElevenLabs API key
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<string|null>} Transcription or null if failed
 */
async function transcribeWithElevenLabs(audioFilePath, apiKey, logger = null) {
  try {
    logger?.info("🎧 Starting ElevenLabs transcription attempt...");
    logger?.debug("Transcription request details", {
      audioFilePath,
      apiKeyLength: apiKey ? apiKey.length : 0,
      apiKeyMasked: apiKey ? `${apiKey.substring(0, 8)}...` : null,
    });

    // Import ElevenLabs SDK
    const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");
    const fs = await import("fs/promises");

    logger?.info("📖 Reading audio file for transcription...");
    const audioBuffer = await fs.readFile(audioFilePath);
    const fileStats = await fs.stat(audioFilePath);

    logger?.debug("Audio file details", {
      filePath: audioFilePath,
      bufferSize: audioBuffer.length,
      fileSize: fileStats.size,
      fileSizeKB: (fileStats.size / 1024).toFixed(2),
      created: fileStats.birthtime,
      modified: fileStats.mtime,
    });

    // Initialize ElevenLabs client
    logger?.info("🔧 Initializing ElevenLabs client...");
    const elevenlabs = new ElevenLabsClient({
      apiKey: apiKey,
    });

    // Create audio blob from buffer
    logger?.info("📦 Preparing audio blob for transcription...");
    const audioBlob = new Blob([audioBuffer], { type: "audio/mp3" });

    logger?.debug("Audio blob details", {
      size: audioBlob.size,
      type: audioBlob.type,
      blobSizeKB: (audioBlob.size / 1024).toFixed(2),
    });

    logger?.debug("Transcription request configuration", {
      modelId: "scribe_v1",
      tagAudioEvents: true,
      languageCode: "eng",
      diarize: false, // Set to false for CAPTCHA as it's usually single speaker
    });

    try {
      logger?.info("🌐 Sending transcription request to ElevenLabs...");

      // Use proper ElevenLabs SDK for speech-to-text
      const transcription = await elevenlabs.speechToText.convert({
        file: audioBlob,
        modelId: "scribe_v1", // Model to use, for now only "scribe_v1" is supported
        tagAudioEvents: true, // Tag audio events like laughter, applause, etc.
        languageCode: "eng", // Language of the audio file
        diarize: false, // Whether to annotate who is speaking (false for CAPTCHA)
      });

      logger?.info("📡 ElevenLabs transcription response received!");
      logger?.debug("Transcription response details", {
        responseType: typeof transcription,
        responseKeys:
          typeof transcription === "object" ? Object.keys(transcription) : null,
        fullResponse: transcription,
      });

      // Extract text from response
      let transcriptionText = null;
      if (typeof transcription === "string") {
        transcriptionText = transcription.trim();
      } else if (transcription && transcription.text) {
        transcriptionText = transcription.text.trim();
      } else if (transcription && transcription.transcription) {
        transcriptionText = transcription.transcription.trim();
      }

      logger?.debug("Transcription extraction", {
        extractedText: transcriptionText || "null/undefined",
        textLength: transcriptionText ? transcriptionText.length : 0,
        extractionMethod:
          typeof transcription === "string"
            ? "direct_string"
            : transcription?.text
            ? "text_property"
            : transcription?.transcription
            ? "transcription_property"
            : "unknown",
      });

      if (transcriptionText && transcriptionText.length > 0) {
        logger?.info("✅ Transcription extracted from response!", {
          transcription:
            transcriptionText.substring(0, 50) +
            (transcriptionText.length > 50 ? "..." : ""),
          fullLength: transcriptionText.length,
          fullText: transcriptionText,
        });

        // Extract middle 4 words to avoid noise at beginning/end
        const cleanedText = extractMiddleFourWords(transcriptionText, logger);

        if (cleanedText) {
          logger?.info("🧹 Cleaned transcription (middle 4 words):", {
            original: transcriptionText,
            cleaned: cleanedText,
            wordCount: cleanedText.split(" ").length,
          });
          return cleanedText;
        } else {
          logger?.warn(
            "⚠️ Could not extract middle words, using full transcription"
          );
          return transcriptionText;
        }
      } else {
        logger?.warn("⚠️ No valid transcription found in response");
        logger?.debug("Response analysis", {
          responseData: transcription,
          hasText: !!transcription?.text,
          hasTranscription: !!transcription?.transcription,
          isString: typeof transcription === "string",
        });
      }
    } catch (apiError) {
      logger?.error("❌ ElevenLabs SDK transcription failed", {
        error: apiError.message,
        stack: apiError.stack,
        code: apiError.code,
        name: apiError.name,
        sdkError: true,
      });
    }

    return null;
  } catch (error) {
    logger?.error("❌ Error in ElevenLabs transcription setup", {
      error: error.message,
      stack: error.stack,
      audioFilePath,
      stage: "setup_error",
    });
    return null;
  }
}

/**
 * Click CAPTCHA checkbox
 * @param {Object} page - Puppeteer page
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<boolean>} True if checkbox was clicked
 */
async function clickCaptchaCheckbox(page, logger = null) {
  try {
    const checkboxSelectors = [
      ".recaptcha-checkbox-border",
      ".recaptcha-checkbox",
      "#recaptcha-anchor",
      'span[role="checkbox"]',
      ".rc-anchor-checkbox",
      'div[class*="recaptcha-checkbox"]',
    ];

    // First try in main page
    for (const selector of checkboxSelectors) {
      try {
        const checkbox = await page.$(selector);
        if (checkbox) {
          logger?.debug(`Found CAPTCHA checkbox with selector: ${selector}`);
          await checkbox.click();
          await sleep(2000, "after checkbox click", logger);
          return true;
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Try in reCAPTCHA iframe
    const recaptchaFrame = page
      .frames()
      .find(
        (frame) =>
          frame.url().includes("recaptcha") && frame.url().includes("anchor")
      );

    if (recaptchaFrame) {
      try {
        for (const selector of checkboxSelectors) {
          try {
            const checkbox = await recaptchaFrame.$(selector);
            if (checkbox) {
              logger?.debug(
                `Found CAPTCHA checkbox in iframe with selector: ${selector}`
              );
              await recaptchaFrame.click(selector);
              await sleep(2000, "after iframe checkbox click", logger);
              return true;
            }
          } catch (e) {
            // Continue
          }
        }
      } catch (frameError) {
        logger?.debug("Error accessing reCAPTCHA frame", {
          error: frameError.message,
        });
      }
    }

    return false;
  } catch (error) {
    logger?.error("Error clicking CAPTCHA checkbox", {
      error: error.message,
    });
    return false;
  }
}

/**
 * Click audio challenge button
 * @param {Object} page - Puppeteer page
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<boolean>} True if audio button was clicked
 */
async function clickAudioButton(page, logger = null) {
  try {
    const audioButtonSelectors = [
      "#recaptcha-audio-button",
      ".rc-button-audio",
      'button[id*="audio"]',
      'button[aria-label*="audio"]',
      'button[title*="audio"]',
      ".recaptcha-checkbox-borderless",
      'span[role="button"]',
    ];

    // Try in main page first
    for (const selector of audioButtonSelectors) {
      try {
        const audioButton = await page.$(selector);
        if (audioButton) {
          logger?.debug(`Found audio button with selector: ${selector}`);
          await audioButton.click();
          await sleep(2000, "after audio button click", logger);
          return true;
        }
      } catch (e) {
        // Continue
      }
    }

    // Try in challenge iframe
    const challengeFrame = page
      .frames()
      .find(
        (frame) =>
          frame.url().includes("recaptcha") && frame.url().includes("bframe")
      );

    if (challengeFrame) {
      try {
        for (const selector of audioButtonSelectors) {
          try {
            const audioButton = await challengeFrame.$(selector);
            if (audioButton) {
              logger?.debug(
                `Found audio button in challenge frame with selector: ${selector}`
              );
              await challengeFrame.click(selector);
              await sleep(2000, "after iframe audio button click", logger);
              return true;
            }
          } catch (e) {
            // Continue
          }
        }
      } catch (frameError) {
        logger?.debug("Error accessing challenge frame", {
          error: frameError.message,
        });
      }
    }

    return false;
  } catch (error) {
    logger?.error("Error clicking audio button", {
      error: error.message,
    });
    return false;
  }
}

// Global state tracker for CAPTCHA detection logging
let lastCaptchaState = null;
let _captchaStateChangeTime = null;

/**
 * Detect if CAPTCHA is present on the page
 * @param {Object} page - Puppeteer page
 * @param {Object} logger - Winston logger instance
 * @param {boolean} forceLog - Force logging regardless of state change
 * @returns {Promise<boolean>} True if CAPTCHA detected
 */
async function detectCaptcha(page, logger = null, forceLog = false) {
  try {
    logger?.debug("Starting CAPTCHA detection");

    // Multiple CAPTCHA detection strategies
    const captchaSelectors = [
      // Standard Google CAPTCHA
      'iframe[src*="recaptcha"]',
      'iframe[title*="reCAPTCHA"]',
      ".g-recaptcha",
      "#recaptcha",

      // Google's automated queries page
      'form[action="/sorry/index"]',
      'form[action*="sorry"]',
      'h1:contains("automated queries")',
      'p:contains("unusual traffic")',
      'p:contains("automated requests")',

      // Various CAPTCHA providers
      'iframe[src*="hcaptcha"]',
      'iframe[src*="funcaptcha"]',
      ".h-captcha",
      ".funcaptcha",

      // Detection keywords in page content
      'h1:contains("security check")',
      'h1:contains("verify")',
      'h1:contains("robot")',
      'p:contains("verify that you")',
      'p:contains("security check")',

      // Form elements that suggest CAPTCHA
      'input[name*="captcha"]',
      'button:contains("verify")',
      'button:contains("continue")',
    ];

    // Check for CAPTCHA elements
    for (const selector of captchaSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          // CAPTCHA detected - log state change
          if (lastCaptchaState !== true || forceLog) {
            logger?.info(`CAPTCHA detected with selector: ${selector}`);
            lastCaptchaState = true;
            _captchaStateChangeTime = Date.now();
          }
          return true;
        }
      } catch (e) {
        // Continue checking other selectors
      }
    }

    // Check page URL for CAPTCHA indicators
    const currentUrl = page.url();
    const captchaUrlPatterns = [
      /sorry.*index/i,
      /captcha/i,
      /verify/i,
      /security.*check/i,
      /robot.*check/i,
    ];

    for (const pattern of captchaUrlPatterns) {
      if (pattern.test(currentUrl)) {
        if (lastCaptchaState !== true || forceLog) {
          logger?.info(`CAPTCHA detected in URL: ${currentUrl}`);
          lastCaptchaState = true;
          _captchaStateChangeTime = Date.now();
        }
        return true;
      }
    }

    // Check page title for CAPTCHA indicators
    const title = await page.title();
    const captchaTitlePatterns = [
      /captcha/i,
      /verify/i,
      /security.*check/i,
      /robot/i,
      /automated.*queries/i,
    ];

    for (const pattern of captchaTitlePatterns) {
      if (pattern.test(title)) {
        if (lastCaptchaState !== true || forceLog) {
          logger?.info(`CAPTCHA detected in title: ${title}`);
          lastCaptchaState = true;
          _captchaStateChangeTime = Date.now();
        }
        return true;
      }
    }

    // Check for specific Google messages
    const bodyText = await page.evaluate(() => {
      if (!document.body || !document.body.innerText) {
        return "";
      }
      return document.body.innerText.toLowerCase();
    });
    const captchaTextPatterns = [
      /automated queries/i,
      /unusual traffic/i,
      /verify that you/i,
      /security check/i,
      /solve.*captcha/i,
      /not a robot/i,
    ];

    for (const pattern of captchaTextPatterns) {
      if (pattern.test(bodyText)) {
        if (lastCaptchaState !== true || forceLog) {
          logger?.info(
            `CAPTCHA detected in page text with pattern: ${pattern}`
          );
          lastCaptchaState = true;
          _captchaStateChangeTime = Date.now();
        }
        return true;
      }
    }

    // No CAPTCHA detected - only log state change or if forced
    if (lastCaptchaState !== false || forceLog) {
      logger?.debug("No CAPTCHA detected");
      lastCaptchaState = false;
      _captchaStateChangeTime = Date.now();
    }

    return false;
  } catch (error) {
    logger?.error("Error during CAPTCHA detection", { error: error.message });
    // In case of error, assume no CAPTCHA to avoid false positives
    return false;
  }
}

/**
 * Reset CAPTCHA detection state (useful when starting new searches)
 */
function resetCaptchaDetectionState() {
  lastCaptchaState = null;
  _captchaStateChangeTime = null;
}

/**
 * Check if page shows "unsupported browser" message for reCAPTCHA
 * @param {Object} page - Puppeteer page
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<boolean>} True if unsupported browser message detected
 */
async function checkForUnsupportedBrowser(page, logger = null) {
  try {
    // Check for the specific "upgrade browser" message
    const hasUnsupportedMessage = await page.evaluate(() => {
      const bodyText =
        document.body.textContent || document.body.innerText || "";

      // Common patterns for unsupported browser messages
      const unsupportedPatterns = [
        /Please upgrade to a.*supported browser.*to get a reCAPTCHA challenge/i,
        /upgrade.*browser.*recaptcha/i,
        /browser.*not.*supported.*recaptcha/i,
        /your browser.*not.*supported/i,
        /update.*browser.*recaptcha/i,
        /browser.*too.*old.*recaptcha/i,
      ];

      // Check patterns in body text
      for (const pattern of unsupportedPatterns) {
        if (pattern.test(bodyText)) {
          return true;
        }
      }

      // Check for specific message elements
      const upgradeLinks = document.querySelectorAll(
        'a[href*="support.google.com/recaptcha"]'
      );
      if (upgradeLinks.length > 0) {
        // Check if the link is in context of browser support
        for (const link of upgradeLinks) {
          const parentText = link.parentElement?.textContent || "";
          if (
            parentText.toLowerCase().includes("supported browser") ||
            parentText.toLowerCase().includes("upgrade")
          ) {
            return true;
          }
        }
      }

      return false;
    });

    if (hasUnsupportedMessage) {
      logger?.warn("🚫 Detected unsupported browser message for reCAPTCHA");
      return true;
    }

    return false;
  } catch (error) {
    logger?.debug("Error checking for unsupported browser message", {
      error: error.message,
    });
    return false;
  }
}

/**
 * Generate a modern, supported user agent string
 * @returns {string} Modern user agent string
 */
function generateModernUserAgent() {
  // Array of modern user agents that are well-supported by Google services
  const modernUserAgents = [
    // Latest Chrome versions
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",

    // Latest Firefox versions
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0",
    "Mozilla/5.0 (X11; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0",

    // Latest Edge versions
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",

    // Latest Safari versions
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15",

    // Mobile versions (also well supported)
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36",
  ];

  // Return a random modern user agent
  return modernUserAgents[Math.floor(Math.random() * modernUserAgents.length)];
}

/**
 * Handle CAPTCHA if detected
 * @param {Object} page - Puppeteer page
 * @param {Object} config - Configuration object
 * @param {Object} logger - Winston logger instance
 * @param {Function} switchProxyCallback - Callback to switch proxy
 * @param {Object} dashboard - Dashboard instance for live updates
 * @returns {Promise<boolean>} True if CAPTCHA was handled successfully
 */
async function handleCaptcha(
  page,
  config,
  logger = null,
  switchProxyCallback = null,
  dashboard = null
) {
  try {
    const isCaptchaPresent = await detectCaptcha(page, logger);

    if (!isCaptchaPresent) {
      return true; // No CAPTCHA, continue normally
    }

    logWithDedup("warning", "🚨 CAPTCHA detected!", chalk.red, logger);
    logger?.warn("CAPTCHA detection confirmed");

    // Check for automated queries message (Google bot detection)
    const automatedQueriesDetected = await page.evaluate(() => {
      const pageText = document.body.textContent || "";
      return (
        pageText.includes(
          "Your computer or network may be sending automated queries"
        ) ||
        pageText.includes(
          "To protect our users, we can't process your request right now"
        ) ||
        pageText.includes("For more details visit our help page")
      );
    });

    if (automatedQueriesDetected) {
      logWithDedup(
        "warning",
        "🤖 Google automated queries detection triggered!",
        chalk.red,
        logger
      );

      if (dashboard && dashboard.addLog) {
        dashboard.addLog(
          "warning",
          "🤖 Google automated queries detection triggered!"
        );
      }

      // If proxy is enabled, restart with new proxy instead of solving CAPTCHA
      if (switchProxyCallback) {
        logWithDedup(
          "info",
          "🔄 Attempting proxy restart due to automated queries detection...",
          chalk.yellow,
          logger
        );

        if (dashboard && dashboard.setStatus) {
          dashboard.setStatus("captcha-proxy");
        }
        if (dashboard && dashboard.addLog) {
          dashboard.addLog(
            "info",
            "🔄 Attempting proxy restart due to automated queries detection..."
          );
        }

        // Try switching proxy immediately
        const proxyChanged = await switchProxyCallback();
        if (proxyChanged) {
          logWithDedup(
            "success",
            "✅ Proxy switched due to automated queries detection",
            chalk.green,
            logger
          );

          if (dashboard && dashboard.addLog) {
            dashboard.addLog(
              "success",
              "✅ Proxy switched due to automated queries detection"
            );
          }

          // Wait for page to reload with new proxy
          await sleep(5000, "waiting for proxy switch to take effect", logger);

          // Check if the issue is resolved
          const stillHasIssue = await page.evaluate(() => {
            const pageText = document.body.textContent || "";
            return pageText.includes(
              "Your computer or network may be sending automated queries"
            );
          });

          if (!stillHasIssue) {
            logWithDedup(
              "success",
              "✅ Automated queries detection resolved with proxy switch!",
              chalk.green,
              logger
            );

            if (dashboard && dashboard.addLog) {
              dashboard.addLog(
                "success",
                "✅ Automated queries detection resolved with proxy switch!"
              );
            }
            return true;
          } else {
            logWithDedup(
              "warning",
              "⚠️ Automated queries detection still present after proxy switch",
              chalk.yellow,
              logger
            );
          }
        } else {
          logWithDedup(
            "warning",
            "⚠️ Failed to switch proxy for automated queries detection",
            chalk.yellow,
            logger
          );
        }
      } else {
        logWithDedup(
          "warning",
          "⚠️ No proxy available - cannot restart for automated queries detection",
          chalk.yellow,
          logger
        );

        if (dashboard && dashboard.addLog) {
          dashboard.addLog(
            "warning",
            "⚠️ No proxy available - cannot restart for automated queries detection"
          );
        }
      }

      // If proxy switch didn't work or not available, return false to avoid CAPTCHA solving
      logWithDedup(
        "warning",
        "❌ Cannot proceed with CAPTCHA due to automated queries detection",
        chalk.red,
        logger
      );

      if (dashboard && dashboard.addLog) {
        dashboard.addLog(
          "error",
          "❌ Cannot proceed with CAPTCHA due to automated queries detection"
        );
      }

      return false;
    }

    // Update dashboard
    if (dashboard && dashboard.setStatus) {
      dashboard.setStatus("captcha");
    }
    if (dashboard && dashboard.addLog) {
      dashboard.addLog("warning", "🚨 CAPTCHA detected!");
    }

    if (dashboard && dashboard.setCaptchaStats && dashboard.stats) {
      const currentStats = dashboard.stats;
      dashboard.setCaptchaStats(
        currentStats.captchaEncounters + 1,
        currentStats.captchaSolved
      );
    }

    if (config.manualCaptchaMode) {
      const solved = await handleManualCaptcha(page, logger);
      if (solved && dashboard && dashboard.setCaptchaStats && dashboard.stats) {
        const currentStats = dashboard.stats;
        dashboard.setCaptchaStats(
          currentStats.captchaEncounters,
          currentStats.captchaSolved + 1
        );
      }
      if (solved && dashboard && dashboard.addLog) {
        dashboard.addLog("success", "✅ CAPTCHA solved manually");
      }
      return solved;
    } else {
      // Automatic CAPTCHA handling
      logWithDedup(
        "info",
        "🤖 Attempting automatic CAPTCHA solving...",
        chalk.cyan,
        logger
      );

      if (dashboard && dashboard.addLog) {
        dashboard.addLog("info", "🤖 Attempting automatic CAPTCHA solving...");
      }

      // First try simple challenge solving
      const simpleSolved = await solveSimpleChallenge(page, logger);
      if (simpleSolved) {
        logWithDedup(
          "success",
          "✅ Simple challenge solved!",
          chalk.green,
          logger
        );
        if (dashboard && dashboard.addLog) {
          dashboard.addLog("success", "✅ Simple challenge solved!");
        }
        return true;
      }

      // If simple challenge didn't work, try audio CAPTCHA
      const solved = await handleAutomaticCaptcha(page, logger, dashboard);

      if (!solved && switchProxyCallback) {
        logWithDedup(
          "warning",
          "🔄 CAPTCHA solving failed, switching proxy...",
          chalk.yellow,
          logger
        );

        if (dashboard && dashboard.setStatus) {
          dashboard.setStatus("captcha-proxy");
        }
        if (dashboard && dashboard.addLog) {
          dashboard.addLog(
            "warning",
            "🔄 CAPTCHA solving failed, switching proxy..."
          );
        }

        // Try switching proxy and attempting again
        const proxyChanged = await switchProxyCallback();
        if (proxyChanged) {
          if (dashboard && dashboard.addLog) {
            dashboard.addLog(
              "info",
              "🌍 Proxy switched successfully, retrying..."
            );
          }

          // Wait for page to reload with new proxy
          await sleep(5000);

          // Check if CAPTCHA is still there after proxy change
          const stillHasCaptcha = await detectCaptcha(page, logger);
          if (!stillHasCaptcha) {
            logWithDedup(
              "success",
              "✅ Proxy switch resolved CAPTCHA!",
              chalk.green,
              logger
            );

            if (dashboard && dashboard.addLog) {
              dashboard.addLog("success", "✅ Proxy switch resolved CAPTCHA!");
            }
            if (dashboard && dashboard.setCaptchaStats && dashboard.stats) {
              const currentStats = dashboard.stats;
              dashboard.setCaptchaStats(
                currentStats.captchaEncounters,
                currentStats.captchaSolved + 1
              );
            }

            return true;
          } else {
            // Try solving again with new proxy
            logWithDedup(
              "info",
              "🔄 Retrying CAPTCHA solving with new proxy...",
              chalk.cyan,
              logger
            );

            if (dashboard && dashboard.addLog) {
              dashboard.addLog(
                "info",
                "🔄 Retrying CAPTCHA solving with new proxy..."
              );
            }

            const retrySolved = await handleAutomaticCaptcha(
              page,
              logger,
              dashboard
            );
            if (
              retrySolved &&
              dashboard &&
              dashboard.setCaptchaStats &&
              dashboard.stats
            ) {
              const currentStats = dashboard.stats;
              dashboard.setCaptchaStats(
                currentStats.captchaEncounters,
                currentStats.captchaSolved + 1
              );
            }
            return retrySolved;
          }
        }
      }

      if (solved && dashboard && dashboard.setCaptchaStats && dashboard.stats) {
        const currentStats = dashboard.stats;
        dashboard.setCaptchaStats(
          currentStats.captchaEncounters,
          currentStats.captchaSolved + 1
        );
      }

      return solved;
    }
  } catch (error) {
    logger?.error("Error handling CAPTCHA", { error: error.message });
    if (dashboard && dashboard.addLog) {
      dashboard.addLog("error", `CAPTCHA handling error: ${error.message}`);
    }
    return false;
  }
}

/**
 * Handle CAPTCHA automatically using audio solving
 * @param {Object} page - Puppeteer page
 * @param {Object} logger - Winston logger instance
 * @param {Object} dashboard - Dashboard instance for live updates
 * @returns {Promise<boolean>} True if CAPTCHA was solved
 */
async function handleAutomaticCaptcha(page, logger = null, dashboard = null) {
  try {
    logWithDedup(
      "info",
      "🤖 Starting automatic CAPTCHA solving workflow",
      chalk.cyan,
      logger
    );

    // Check for "upgrade browser" message first
    const needsUserAgentChange = await checkForUnsupportedBrowser(page, logger);
    if (needsUserAgentChange) {
      logger?.info(
        "🔄 Detected unsupported browser message - switching user agent"
      );

      // Generate a more modern user agent
      const newUserAgent = generateModernUserAgent();
      logger?.info(
        `🔄 Switching to user agent: ${newUserAgent.substring(0, 50)}...`
      );

      try {
        // Set new user agent
        await page.setUserAgent(newUserAgent);
        await sleep(1000, "after user agent change", logger);

        // Refresh the page to get the new CAPTCHA with updated user agent
        logger?.info("🔄 Refreshing page with new user agent");
        await page.reload({ waitUntil: "networkidle0", timeout: 30000 });
        await sleep(3000, "after page refresh with new user agent", logger);

        // Verify the upgrade message is gone
        const stillNeedsUpgrade = await checkForUnsupportedBrowser(
          page,
          logger
        );
        if (stillNeedsUpgrade) {
          logger?.warn(
            "⚠️ Still showing upgrade message after user agent change"
          );
          return false;
        } else {
          logger?.info(
            "✅ Browser upgrade message resolved - proceeding with CAPTCHA"
          );
        }
      } catch (error) {
        logger?.error("Error changing user agent", { error: error.message });
        return false;
      }
    }

    // Step 1: First click the CAPTCHA checkbox to start the challenge
    logWithDedup(
      "info",
      "📋 Step 1: Clicking CAPTCHA checkbox",
      chalk.blue,
      logger
    );

    // Wait for checkbox to be available
    const anchorFrame = await waitForRecaptchaFrame(page, "anchor", logger);
    if (!anchorFrame) {
      logWithDedup(
        "warning",
        "⚠️ Could not find reCAPTCHA anchor frame",
        chalk.yellow,
        logger
      );
      return false;
    }

    // Click the checkbox with specific selector
    const checkboxClicked = await clickElementInFrame(
      anchorFrame,
      ".recaptcha-checkbox",
      logger
    );

    if (!checkboxClicked) {
      logWithDedup(
        "warning",
        "⚠️ Could not click CAPTCHA checkbox",
        chalk.yellow,
        logger
      );
      return false;
    }

    // Wait for challenge frame to appear
    await sleep(2000, "waiting for challenge to load", logger);

    // Step 2: Wait for and access the challenge frame
    const challengeFrame = await waitForRecaptchaFrame(page, "bframe", logger);
    if (!challengeFrame) {
      logWithDedup(
        "warning",
        "⚠️ Could not find reCAPTCHA challenge frame",
        chalk.yellow,
        logger
      );
      return false;
    }

    // Step 3: Click the audio button
    logWithDedup(
      "info",
      "🎵 Step 2: Clicking audio challenge button",
      chalk.blue,
      logger
    );

    // Wait for audio button to be available and click it
    const audioButtonClicked = await waitAndClickInFrame(
      challengeFrame,
      "#recaptcha-audio-button",
      logger,
      5000
    );

    if (!audioButtonClicked) {
      logWithDedup(
        "warning",
        "⚠️ Could not find or click audio challenge button",
        chalk.yellow,
        logger
      );
      return false;
    }

    // Wait for audio challenge to load
    await sleep(3000, "waiting for audio challenge to load", logger);

    // Step 4: Find and download the audio
    logWithDedup(
      "info",
      "🎧 Step 3: Finding and transcribing audio",
      chalk.blue,
      logger
    );

    // Wait for audio source to appear - try download link first, then audio element
    let audioSrc = await waitForElementAndGetAttribute(
      challengeFrame,
      ".rc-audiochallenge-tdownload-link",
      "href",
      logger,
      10000
    );

    // If download link not found, try the audio element
    if (!audioSrc) {
      logger?.debug("Download link not found, trying audio element");
      audioSrc = await waitForElementAndGetAttribute(
        challengeFrame,
        "#audio-source",
        "src",
        logger,
        5000
      );
    }

    if (!audioSrc) {
      logWithDedup(
        "warning",
        "⚠️ Could not find audio source (neither download link nor audio element)",
        chalk.yellow,
        logger
      );
      if (dashboard && dashboard.addLog) {
        dashboard.addLog("warning", "⚠️ Could not find audio source");
      }
      return false;
    }

    logger?.info(`Found audio source: ${audioSrc}`);

    // Step 5: Transcribe the audio
    if (dashboard && dashboard.setStatus) {
      dashboard.setStatus("captcha-transcribing");
    }

    const solution = await solveAudioCaptcha(audioSrc, logger);
    if (!solution) {
      logWithDedup(
        "warning",
        "⚠️ Failed to transcribe audio",
        chalk.yellow,
        logger
      );
      if (dashboard && dashboard.setStatus) {
        dashboard.setStatus("captcha");
      }
      return false;
    }

    logWithDedup(
      "success",
      `✅ Audio transcribed: "${solution}"`,
      chalk.green,
      logger
    );

    // Step 6: Enter the solution
    logWithDedup(
      "info",
      "📝 Step 4: Entering transcription",
      chalk.blue,
      logger
    );

    // Wait for and fill the audio response input
    const inputFilled = await waitAndFillInput(
      challengeFrame,
      "#audio-response",
      solution,
      logger,
      5000
    );

    if (!inputFilled) {
      logWithDedup(
        "warning",
        "⚠️ Could not find or fill audio response input",
        chalk.yellow,
        logger
      );
      return false;
    }

    await sleep(1000, "after entering solution", logger);

    // Step 7: Submit the solution
    logWithDedup("info", "✔️ Step 5: Verifying solution", chalk.blue, logger);

    const verifyClicked = await waitAndClickInFrame(
      challengeFrame,
      "#recaptcha-verify-button",
      logger,
      5000
    );

    if (!verifyClicked) {
      logWithDedup(
        "warning",
        "⚠️ Could not click verify button",
        chalk.yellow,
        logger
      );
      return false;
    }

    // Wait for verification to complete
    await sleep(5000, "waiting for verification", logger);

    // Check if CAPTCHA was solved
    const solved = await isCaptchaSolved(page, logger);

    if (solved) {
      logWithDedup(
        "success",
        "✅ Audio CAPTCHA solved successfully!",
        chalk.green,
        logger
      );
      if (dashboard && dashboard.addLog) {
        dashboard.addLog("success", "✅ Audio CAPTCHA solved successfully!");
      }
      if (dashboard && dashboard.setCaptchaStats && dashboard.stats) {
        const currentStats = dashboard.stats;
        dashboard.setCaptchaStats(
          currentStats.captchaEncounters,
          currentStats.captchaSolved + 1
        );
      }
    } else {
      logWithDedup(
        "warning",
        "⚠️ Audio CAPTCHA solution was incorrect",
        chalk.yellow,
        logger
      );
      if (dashboard && dashboard.addLog) {
        dashboard.addLog("warning", "⚠️ Audio CAPTCHA solution was incorrect");
      }
    }

    return solved;
  } catch (error) {
    logger?.error("Error in automatic CAPTCHA handling", {
      error: error.message,
      stack: error.stack,
    });
    logWithDedup(
      "error",
      "❌ Automatic CAPTCHA solving failed",
      chalk.red,
      logger
    );
    if (dashboard && dashboard.addLog) {
      dashboard.addLog(
        "error",
        `❌ Automatic CAPTCHA solving failed: ${error.message}`
      );
    }
    return false;
  }
}

/**
 * Wait for reCAPTCHA frame to be available
 * @param {Object} page - Puppeteer page
 * @param {string} frameType - Type of frame ("anchor" or "bframe")
 * @param {Object} logger - Winston logger instance
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Object|null>} Frame object or null
 */
async function waitForRecaptchaFrame(
  page,
  frameType,
  logger = null,
  timeout = 10000
) {
  try {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const frames = page.frames();
      const frame = frames.find(
        (f) => f.url().includes("recaptcha") && f.url().includes(frameType)
      );

      if (frame) {
        logger?.debug(`Found reCAPTCHA ${frameType} frame`);
        return frame;
      }

      await sleep(500, `waiting for ${frameType} frame`, logger);
    }

    logger?.warn(`Timeout waiting for reCAPTCHA ${frameType} frame`);
    return null;
  } catch (error) {
    logger?.error(`Error waiting for reCAPTCHA ${frameType} frame`, {
      error: error.message,
    });
    return null;
  }
}

/**
 * Click element in frame
 * @param {Object} frame - Puppeteer frame
 * @param {string} selector - Element selector
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<boolean>} True if clicked
 */
async function clickElementInFrame(frame, selector, logger = null) {
  try {
    const element = await frame.$(selector);
    if (element) {
      await element.click();
      logger?.debug(`Clicked element ${selector} in frame`);
      return true;
    }
    return false;
  } catch (error) {
    logger?.error(`Error clicking element ${selector} in frame`, {
      error: error.message,
    });
    return false;
  }
}

/**
 * Wait for element and click it in frame
 * @param {Object} frame - Puppeteer frame
 * @param {string} selector - Element selector
 * @param {Object} logger - Winston logger instance
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>} True if clicked
 */
async function waitAndClickInFrame(
  frame,
  selector,
  logger = null,
  timeout = 10000
) {
  try {
    await frame.waitForSelector(selector, { visible: true, timeout });
    const element = await frame.$(selector);
    if (element) {
      await element.click();
      logger?.debug(`Waited for and clicked element ${selector} in frame`);
      return true;
    }
    return false;
  } catch (error) {
    logger?.error(`Error waiting/clicking element ${selector} in frame`, {
      error: error.message,
    });
    return false;
  }
}

/**
 * Wait for element and get attribute value
 * @param {Object} frame - Puppeteer frame
 * @param {string} selector - Element selector
 * @param {string} attribute - Attribute name
 * @param {Object} logger - Winston logger instance
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<string|null>} Attribute value or null
 */
async function waitForElementAndGetAttribute(
  frame,
  selector,
  attribute,
  logger = null,
  timeout = 10000
) {
  try {
    await frame.waitForSelector(selector, { visible: true, timeout });
    const value = await frame.$eval(
      selector,
      (el, attr) => el.getAttribute(attr),
      attribute
    );
    logger?.debug(`Got ${attribute} from element ${selector}: ${value}`);
    return value;
  } catch (error) {
    logger?.error(`Error getting ${attribute} from element ${selector}`, {
      error: error.message,
    });
    return null;
  }
}

/**
 * Wait for input and fill it
 * @param {Object} frame - Puppeteer frame
 * @param {string} selector - Input selector
 * @param {string} value - Value to type
 * @param {Object} logger - Winston logger instance
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>} True if filled
 */
async function waitAndFillInput(
  frame,
  selector,
  value,
  logger = null,
  timeout = 10000
) {
  try {
    await frame.waitForSelector(selector, { visible: true, timeout });
    const input = await frame.$(selector);
    if (input) {
      // Clear existing value
      await input.click({ clickCount: 3 });
      await input.press("Backspace");
      // Type new value
      await input.type(value);
      logger?.debug(`Filled input ${selector} with value`);
      return true;
    }
    return false;
  } catch (error) {
    logger?.error(`Error filling input ${selector}`, {
      error: error.message,
    });
    return false;
  }
}

/**
 * Check if CAPTCHA was solved
 * @param {Object} page - Puppeteer page
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<boolean>} True if solved
 */
async function isCaptchaSolved(page, logger = null) {
  try {
    // Check if we're still on a CAPTCHA page
    const stillHasCaptcha = await detectCaptcha(page, logger);
    if (!stillHasCaptcha) {
      return true;
    }

    // Check for success indicators in the anchor frame
    const anchorFrame = await waitForRecaptchaFrame(
      page,
      "anchor",
      logger,
      3000
    );
    if (anchorFrame) {
      const isChecked = await anchorFrame.evaluate(() => {
        const checkbox = document.querySelector(".recaptcha-checkbox");
        return checkbox && checkbox.getAttribute("aria-checked") === "true";
      });

      if (isChecked) {
        logger?.info("CAPTCHA checkbox is checked - solved!");
        return true;
      }
    }

    return false;
  } catch (error) {
    logger?.error("Error checking if CAPTCHA is solved", {
      error: error.message,
    });
    return false;
  }
}

/**
 * Solve simple CAPTCHA challenges (math, text, etc.)
 * @param {Object} page - Puppeteer page
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<boolean>} True if challenge was solved
 */
async function solveSimpleChallenge(page, logger = null) {
  try {
    logger?.info("Attempting to solve simple CAPTCHA challenge");

    // Check for math challenges
    const mathChallengeText = await page.evaluate(() => {
      const text = document.body.innerText;
      const mathPattern = /(\d+)\s*[+\-*/]\s*(\d+)\s*=\s*\?/;
      const match = text.match(mathPattern);
      return match ? match[0] : null;
    });

    if (mathChallengeText) {
      const solution = solveMathChallenge(mathChallengeText);
      if (solution !== null) {
        // Find input field and enter solution
        const inputField =
          (await page.$('input[type="text"]')) ||
          (await page.$('input[type="number"]')) ||
          (await page.$('input[name*="answer"]')) ||
          (await page.$('input[name*="captcha"]'));

        if (inputField) {
          await inputField.type(solution.toString());
          await sleep(1000);

          // Find and click submit button
          const submitButton =
            (await page.$('button[type="submit"]')) ||
            (await page.$('input[type="submit"]')) ||
            (await page.$('button:contains("Submit")')) ||
            (await page.$('button:contains("Continue")'));

          if (submitButton) {
            await submitButton.click();
            await sleep(3000);
            logger?.info(
              `Math challenge solved: ${mathChallengeText} = ${solution}`
            );
            return true;
          }
        }
      }
    }

    // Check for simple "I'm not a robot" checkboxes
    const robotCheckboxSelectors = [
      'input[type="checkbox"][name*="robot"]',
      ".recaptcha-checkbox",
      "#robot-checkbox",
      'input[value*="human"]',
    ];

    for (const selector of robotCheckboxSelectors) {
      const checkbox = await page.$(selector);
      if (checkbox) {
        const isChecked = await page.evaluate((el) => el.checked, checkbox);
        if (!isChecked) {
          await checkbox.click();
          await sleep(2000);
          logger?.info("Clicked 'I'm not a robot' checkbox");
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    logger?.error("Error solving simple challenge", { error: error.message });
    return false;
  }
}

/**
 * Solve math challenge
 * @param {string} challengeText - Math challenge text
 * @returns {number|null} Solution or null if unsolvable
 */
function solveMathChallenge(challengeText) {
  try {
    const mathPattern = /(\d+)\s*([+\-*/])\s*(\d+)\s*=\s*\?/;
    const match = challengeText.match(mathPattern);

    if (!match) return null;

    const num1 = parseInt(match[1]);
    const operator = match[2];
    const num2 = parseInt(match[3]);

    switch (operator) {
      case "+":
        return num1 + num2;
      case "-":
        return num1 - num2;
      case "*":
        return num1 * num2;
      case "/":
        return Math.floor(num1 / num2);
      default:
        return null;
    }
  } catch (error) {
    return null;
  }
}

/**
 * Solve audio CAPTCHA using speech recognition
 * @param {string} audioSrc - Audio source URL
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<string|null>} Recognized text or null if failed
 */
async function solveAudioCaptcha(audioSrc, logger = null) {
  try {
    logWithDedup("info", "🎵 Processing audio CAPTCHA...", chalk.cyan, logger);

    logger?.info("🔍 Audio CAPTCHA processing started");
    logger?.info(`📍 Audio source URL: ${audioSrc}`);
    logger?.debug("Audio source details", {
      url: audioSrc,
      urlLength: audioSrc.length,
      domain: new URL(audioSrc).hostname,
      pathname: new URL(audioSrc).pathname,
      protocol: new URL(audioSrc).protocol,
    });

    // Import required modules for audio processing
    const fs = await import("fs/promises");
    const path = await import("path");
    const axios = (await import("axios")).default;
    const { createWriteStream } = await import("fs");
    const { pipeline } = await import("stream/promises");

    // Step 1: Download the audio file
    const tempDir = path.join(process.cwd(), "temp");
    await fs.mkdir(tempDir, { recursive: true });

    const fileName = `captcha_audio_${Date.now()}.mp3`;
    const filePath = path.join(tempDir, fileName);

    logWithDedup("info", "📥 Downloading audio file...", chalk.blue, logger);
    logger?.info(`📁 Download destination: ${filePath}`);

    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    };

    logger?.debug("Download request configuration", {
      url: audioSrc,
      headers,
      timeout: 30000,
      responseType: "stream",
    });

    const response = await axios({
      method: "GET",
      url: audioSrc,
      responseType: "stream",
      headers,
      timeout: 30000,
    });

    logger?.info("📡 Download response received!");
    logger?.debug("Download response details", {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      contentLength: response.headers["content-length"],
      contentType: response.headers["content-type"],
    });

    if (response.headers["content-length"]) {
      const fileSize = parseInt(response.headers["content-length"]);
      logger?.info(
        `📊 Expected file size: ${fileSize} bytes (${(fileSize / 1024).toFixed(
          2
        )} KB)`
      );
    }

    const writer = createWriteStream(filePath);
    let downloadedBytes = 0;

    response.data.on("data", (chunk) => {
      downloadedBytes += chunk.length;
      if (response.headers["content-length"]) {
        const progress = (
          (downloadedBytes / parseInt(response.headers["content-length"])) *
          100
        ).toFixed(1);
        logger?.debug(
          `Download progress: ${progress}% (${downloadedBytes} bytes)`
        );
      }
    });

    await pipeline(response.data, writer);

    // Get final file stats
    const fileStats = await fs.stat(filePath);
    logger?.info("✅ Audio file downloaded successfully!");
    logger?.debug("Downloaded file details", {
      filePath,
      fileName,
      finalSize: fileStats.size,
      finalSizeKB: (fileStats.size / 1024).toFixed(2),
      downloadedBytes,
      created: fileStats.birthtime,
      modified: fileStats.mtime,
    });

    // Step 2: Attempt transcription using ElevenLabs API
    const { ELEVENLABS_CONFIG } = await import("../config/index.js");

    if (ELEVENLABS_CONFIG.apiKey) {
      logWithDedup(
        "info",
        "🎧 Attempting audio transcription with ElevenLabs...",
        chalk.blue,
        logger
      );

      logger?.debug("ElevenLabs configuration", {
        hasApiKey: !!ELEVENLABS_CONFIG.apiKey,
        apiKeyLength: ELEVENLABS_CONFIG.apiKey
          ? ELEVENLABS_CONFIG.apiKey.length
          : 0,
      });

      try {
        const transcription = await transcribeWithElevenLabs(
          filePath,
          ELEVENLABS_CONFIG.apiKey,
          logger
        );

        // Cleanup audio file
        try {
          await fs.unlink(filePath);
          logger?.debug("Audio file cleaned up", { filePath });
        } catch (e) {
          logger?.warn("Failed to cleanup audio file", {
            filePath,
            error: e.message,
          });
        }

        if (transcription && transcription.length > 0) {
          logWithDedup(
            "success",
            `✅ Audio transcribed: "${transcription}"`,
            chalk.green,
            logger
          );
          logger?.info("Transcription successful!", {
            transcription,
            length: transcription.length,
          });
          return transcription;
        } else {
          logWithDedup(
            "warning",
            "⚠️ ElevenLabs transcription failed or returned empty result",
            chalk.yellow,
            logger
          );
          logger?.warn("Empty or null transcription result");
        }
      } catch (elevenLabsError) {
        logger?.error("ElevenLabs transcription failed", {
          error: elevenLabsError.message,
          stack: elevenLabsError.stack,
          code: elevenLabsError.code,
        });
        logWithDedup(
          "warning",
          "⚠️ ElevenLabs API error - falling back to proxy switch",
          chalk.yellow,
          logger
        );
      }
    } else {
      logWithDedup(
        "warning",
        "⚠️ No ElevenLabs API key configured",
        chalk.yellow,
        logger
      );
      logger?.warn("ElevenLabs API key not found in configuration");
    }

    // Cleanup audio file
    try {
      await fs.unlink(filePath);
      logger?.debug("Audio file cleaned up after failed transcription", {
        filePath,
      });
    } catch (e) {
      logger?.warn("Failed to cleanup audio file after failed transcription", {
        filePath,
        error: e.message,
      });
    }

    // If transcription failed, fall back to proxy switching
    logWithDedup(
      "warning",
      "⚠️ Audio CAPTCHA solving failed - falling back to proxy switch",
      chalk.yellow,
      logger
    );

    return null;
  } catch (error) {
    logger?.error("Error solving audio CAPTCHA", {
      error: error.message,
      stack: error.stack,
      audioSrc,
      stage: "general_error",
    });
    return null;
  }
}

/**
 * Handle CAPTCHA manually (wait for user input)
 * @param {Object} page - Puppeteer page
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<boolean>} True if CAPTCHA was solved
 */
async function handleManualCaptcha(page, logger = null) {
  try {
    logWithDedup(
      "info",
      "⏳ Manual CAPTCHA mode - waiting for user input...",
      chalk.yellow,
      logger
    );
    logWithDedup(
      "info",
      "Please solve the CAPTCHA in the browser window and press Enter when done.",
      chalk.white,
      logger
    );

    // Wait for user input
    await new Promise((resolve) => {
      process.stdin.once("data", () => {
        resolve();
      });
    });

    // Verify CAPTCHA was solved
    const captchaStillPresent = await detectCaptcha(page, logger);

    if (!captchaStillPresent) {
      logWithDedup(
        "success",
        "✅ CAPTCHA solved successfully!",
        chalk.green,
        logger
      );
      logger?.info("CAPTCHA solved by user");
      return true;
    } else {
      logWithDedup(
        "warning",
        "⚠️ CAPTCHA still present - trying again...",
        chalk.yellow,
        logger
      );
      logger?.warn("CAPTCHA still detected after user input");
      return false;
    }
  } catch (error) {
    logger?.error("Error in manual CAPTCHA handling", { error: error.message });
    return false;
  }
}

/**
 * Check if current page is Google's "sorry" page
 * @param {Object} page - Puppeteer page
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<boolean>} True if on sorry page
 */
async function isOnSorryPage(page, logger = null) {
  try {
    const url = page.url();
    const title = await page.title();

    const sorryIndicators = [
      url.includes("sorry"),
      url.includes("captcha"),
      title.toLowerCase().includes("captcha"),
      title.toLowerCase().includes("automated queries"),
    ];

    const isSorryPage = sorryIndicators.some((indicator) => indicator);

    if (isSorryPage) {
      logger?.warn("Detected Google's sorry/CAPTCHA page", { url, title });
    }

    return isSorryPage;
  } catch (error) {
    logger?.error("Error checking for sorry page", { error: error.message });
    return false;
  }
}

export {
  detectCaptcha,
  handleCaptcha,
  handleManualCaptcha,
  isOnSorryPage,
  handleAutomaticCaptcha,
  solveAudioCaptcha,
  solveSimpleChallenge,
  clickCaptchaCheckbox,
  clickAudioButton,
  waitForRecaptchaFrame,
  clickElementInFrame,
  waitAndClickInFrame,
  waitForElementAndGetAttribute,
  waitAndFillInput,
  isCaptchaSolved,
  resetCaptchaDetectionState,
};
