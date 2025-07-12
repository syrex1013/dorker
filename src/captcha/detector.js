import chalk from "chalk";
import { logWithDedup } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";

/**
 * Wait for CAPTCHA element to be ready for interaction
 * @param {Object} page - Puppeteer page
 * @param {string} selector - Element selector
 * @param {Object} logger - Logger instance
 * @param {number} timeout - Timeout in milliseconds
 */
async function waitForCaptchaElement(page, selector, logger = null, timeout = 5000) {
  try {
    await page.waitForSelector(selector, { timeout, visible: true });
    // Additional wait for element to be interactive
    await page.waitForFunction((sel) => {
      const element = document.querySelector(sel);
      return element && !element.disabled && element.offsetParent !== null;
    }, { timeout: 2000 }, selector).catch(() => null);
    
    logger?.debug(`CAPTCHA element ready: ${selector}`);
  } catch (error) {
    logger?.debug(`CAPTCHA element wait failed for ${selector}: ${error.message}`);
  }
}

/**
 * Wait for CAPTCHA frame to be ready
 * @param {Object} page - Puppeteer page
 * @param {string} frameType - Type of frame (anchor/bframe)
 * @param {Object} logger - Logger instance
 * @param {number} timeout - Timeout in milliseconds
 */
async function waitForCaptchaFrameReady(page, frameType, logger = null, timeout = 5000) {
  try {
    await page.waitForFunction((type) => {
      const frames = Array.from(document.querySelectorAll('iframe'));
      return frames.some(frame => 
        frame.src.includes('recaptcha') && 
        frame.src.includes(type) &&
        frame.offsetParent !== null
      );
    }, { timeout }, frameType).catch(() => null);
    
    logger?.debug(`CAPTCHA ${frameType} frame ready`);
  } catch (error) {
    logger?.debug(`CAPTCHA ${frameType} frame wait failed: ${error.message}`);
  }
}

/**
 * Wait for CAPTCHA challenge to appear
 * @param {Object} page - Puppeteer page
 * @param {Object} logger - Logger instance
 * @param {number} timeout - Timeout in milliseconds
 */
async function waitForCaptchaChallenge(page, logger = null, timeout = 5000) {
  try {
    await page.waitForFunction(() => {
      // Enhanced challenge selectors for better headless compatibility
      const challengeSelectors = [
        '.rc-audiochallenge-tbl',
        '.rc-imageselect-table',
        '.rc-challenge-help',
        '#audio-source',
        '.rc-audiochallenge-instructions',
        '.rc-audiochallenge-tdownload-link',
        '.rc-audiochallenge-response-field',
        'audio',
        '[src*="audio"]',
        '[href*="audio"]'
      ];
      
      return challengeSelectors.some(selector => {
        const element = document.querySelector(selector);
        // In headless mode, offsetParent check might not work reliably
        // So also check if element exists and has content
        return element && (
          element.offsetParent !== null || 
          element.style.display !== 'none' ||
          element.href ||
          element.src
        );
      });
    }, { timeout }).catch(() => null);
    
    logger?.debug("CAPTCHA challenge appeared");
  } catch (error) {
    logger?.debug(`CAPTCHA challenge wait failed: ${error.message}`);
  }
}

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
          await waitForCaptchaChallenge(page, logger, 3000);
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
              await waitForCaptchaChallenge(page, logger, 3000);
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
          await waitForCaptchaChallenge(page, logger, 3000);
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
              await waitForCaptchaChallenge(page, logger, 3000);
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

/**
 * Detect if a CAPTCHA is present on the page
 * @param {Object} page - Puppeteer page
 * @param {Object} logger - Winston logger instance
 * @param {Boolean} forceLog - Whether to force logging even if duplicate
 * @returns {Promise<boolean>} True if CAPTCHA is detected
 */
async function detectCaptcha(page, logger = null, forceLog = false) {
  try {
    // Skip detection if page is not available
    if (!page) {
      return false;
    }

    // Check if URL is available (page might be closed)
    let url;
    try {
      url = page.url();
    } catch (e) {
      return false;
    }

    // Quick check for obvious CAPTCHA URLs
    if (url.includes("recaptcha") || url.includes("captcha")) {
      if (forceLog || !detectCaptcha.lastDetected || Date.now() - detectCaptcha.lastDetected > 5000) {
        logger?.warn("CAPTCHA detected via URL", { url });
        detectCaptcha.lastDetected = Date.now();
      }
      return true;
    }

    // Check for CAPTCHA frames
    try {
      const frames = page.frames();
      for (const frame of frames) {
        try {
          const frameUrl = frame.url();
          if (frameUrl.includes("recaptcha") || frameUrl.includes("captcha")) {
            if (forceLog || !detectCaptcha.lastDetected || Date.now() - detectCaptcha.lastDetected > 5000) {
              logger?.warn("CAPTCHA detected via frame URL", { frameUrl });
              detectCaptcha.lastDetected = Date.now();
            }
            return true;
          }
        } catch (e) {
          // Skip frames that can't be accessed
        }
      }
    } catch (e) {
      // Skip frame check if it fails
    }

    // Check for CAPTCHA elements
    try {
      const hasCaptchaElements = await page.evaluate(() => {
        // Simple check for CAPTCHA elements
        const captchaSelectors = [
          'iframe[src*="recaptcha"]',
          'iframe[title*="recaptcha"]',
          '.g-recaptcha',
          '#captcha',
          '.captcha',
          '.recaptcha',
          'div[class*="captcha"]',
          'div[id*="captcha"]'
        ];
        
        for (const selector of captchaSelectors) {
          if (document.querySelector(selector)) {
            return true;
          }
        }

        // Check for CAPTCHA text in body
        const bodyText = document.body.innerText.toLowerCase();
        return bodyText.includes('captcha') || 
               bodyText.includes('robot') || 
               bodyText.includes('human verification');
      }).catch(() => false); // Default to false on evaluation error

      if (hasCaptchaElements) {
        if (forceLog || !detectCaptcha.lastDetected || Date.now() - detectCaptcha.lastDetected > 5000) {
          logger?.warn("CAPTCHA detected via page elements");
          detectCaptcha.lastDetected = Date.now();
        }
        return true;
      }
    } catch (error) {
      // Ignore page evaluation errors
      if (error.message.includes("Execution context was destroyed") || 
          error.message.includes("Target closed") ||
          error.message.includes("navigation")) {
        logger?.debug("Page navigation during CAPTCHA check - skipping element detection");
      }
    }

    // No CAPTCHA detected
    return false;
  } catch (error) {
    // Handle specific navigation errors
    if (error.message.includes("Execution context was destroyed") || 
        error.message.includes("Target closed") ||
        error.message.includes("navigation")) {
      logger?.debug("Navigation occurred during CAPTCHA detection", {
        error: error.message,
      });
      return false;
    }
    
    logger?.error("Error detecting CAPTCHA", {
      error: error.message,
      stack: error.stack,
    });
    return false;
  }
}

// Keep track of last detection to avoid spamming logs
detectCaptcha.lastDetected = null;

/**
 * Reset CAPTCHA detection state (useful when starting new searches)
 */
function resetCaptchaDetectionState() {
  // lastCaptchaState = null; // Removed
  // _captchaStateChangeTime = null; // Removed
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
 * Handle CAPTCHA detection and solving
 * @param {Object} page - Puppeteer page
 * @param {Object} config - Configuration object
 * @param {Object} logger - Winston logger instance
 * @param {Function} switchProxyCallback - Callback to switch proxy if needed
 * @param {Object} dashboard - Dashboard instance for live updates
 * @param {Object} pageData - Optional pageData object containing cursor
 * @returns {Promise<boolean>} True if CAPTCHA was handled successfully
 */
async function handleCaptcha(
  page,
  config,
  logger = null,
  switchProxyCallback = null,
  dashboard = null,
  pageData = null
) {
  try {
    // Check if CAPTCHA is already being processed by background monitor
    if (page._captchaBeingProcessed) {
      logger?.info("CAPTCHA is already being handled by background monitor");
      // Wait for background monitor to finish
      let attempts = 0;
      while (page._captchaBeingProcessed && attempts < 30) {
        await waitForCaptchaFrameReady(page, "anchor", logger, 2000);
        attempts++;
      }
      // Check if CAPTCHA was solved
      const stillHasCaptcha = await detectCaptcha(page, logger);
      return !stillHasCaptcha;
    }

    // Check if CAPTCHA is present
    const captchaDetected = await detectCaptcha(page, logger);

    if (captchaDetected) {
      logWithDedup(
        "warning",
        "🚨 CAPTCHA detected!",
        chalk.red,
        logger,
        "captcha-warning"
      );

      // Log detection confirmation
      logger?.warn("CAPTCHA detection confirmed");

      // Update dashboard status
      if (dashboard && dashboard.setStatus) {
        dashboard.setStatus("captcha");
      }
      if (dashboard && dashboard.addLog) {
        dashboard.addLog("warning", "🚨 CAPTCHA detected!");
      }
      // Increment CAPTCHA counter
      if (dashboard && dashboard.incrementCaptchaEncounters) {
        dashboard.incrementCaptchaEncounters();
      }

      // Attempt to handle CAPTCHA
      if (config.manualCaptchaMode) {
        // Manual mode
        logWithDedup(
          "info",
          "⏸️ Manual CAPTCHA mode - waiting for user to solve...",
          chalk.yellow,
          logger
        );

        if (dashboard && dashboard.addLog) {
          dashboard.addLog(
            "info",
            "⏸️ Manual CAPTCHA mode - waiting for user to solve..."
          );
        }

        // Wait for manual solving
        const solved = await handleManualCaptcha(page, logger);

        // Update dashboard status back to normal
        if (dashboard && dashboard.setStatus) {
          dashboard.setStatus("running");
        }

        return solved;
      } else {
        // Automatic mode
        logWithDedup(
          "info",
          "🤖 Attempting automatic CAPTCHA solving...",
          chalk.cyan,
          logger
        );

        if (dashboard && dashboard.addLog) {
          dashboard.addLog(
            "info",
            "🤖 Attempting automatic CAPTCHA solving..."
          );
        }

        // Try to solve simple checkbox CAPTCHA
        const simpleCheckboxSolved = await solveSimpleChallenge(page, logger);
        if (simpleCheckboxSolved) {
          logWithDedup(
            "success",
            "✅ Simple CAPTCHA checkbox solved!",
            chalk.green,
            logger
          );
          if (dashboard && dashboard.addLog) {
            dashboard.addLog("success", "✅ Simple CAPTCHA checkbox solved!");
          }
          if (dashboard && dashboard.incrementCaptchaSolved) {
            dashboard.incrementCaptchaSolved();
          }
          // Update dashboard status back to normal
          if (dashboard && dashboard.setStatus) {
            dashboard.setStatus("running");
          }
          return true;
        }

        // Try audio CAPTCHA solving
        const audioSolved = await handleAutomaticCaptcha.call(
          pageData || { page, cursor: null, dashboard },
          page,
          logger,
          dashboard
        );

        if (audioSolved) {
          // Update dashboard status back to normal
          if (dashboard && dashboard.setStatus) {
            dashboard.setStatus("running");
          }
          return true;
        }

        // If automatic solving failed and proxy switching is available
        if (!audioSolved && switchProxyCallback) {
          logWithDedup(
            "info",
            "🔄 Switching proxy due to CAPTCHA...",
            chalk.blue,
            logger
          );
          if (dashboard && dashboard.addLog) {
            dashboard.addLog("info", "🔄 Switching proxy due to CAPTCHA...");
          }

          const proxySwitched = await switchProxyCallback();
          if (proxySwitched) {
            logWithDedup(
              "success",
              "✅ Proxy switched successfully",
              chalk.green,
              logger
            );
            if (dashboard && dashboard.addLog) {
              dashboard.addLog("success", "✅ Proxy switched successfully");
            }
            if (dashboard && dashboard.incrementCaptchaSolved) {
              dashboard.incrementCaptchaSolved();
            }
            // Update dashboard status back to normal
            if (dashboard && dashboard.setStatus) {
              dashboard.setStatus("running");
            }
            return true;
          }
        }

        // If all else fails
        logWithDedup(
          "error",
          "❌ Failed to solve CAPTCHA automatically",
          chalk.red,
          logger
        );
        if (dashboard && dashboard.addLog) {
          dashboard.addLog("error", "❌ Failed to solve CAPTCHA automatically");
        }
        if (dashboard && dashboard.incrementCaptchaEncounters) {
          dashboard.incrementCaptchaEncounters();
        }
        // Update dashboard status to error
        if (dashboard && dashboard.setStatus) {
          dashboard.setStatus("error");
        }
        return false;
      }
    }

    // No CAPTCHA detected
    return true;
  } catch (error) {
    logger?.error("Error in CAPTCHA handling", {
      error: error.message,
      stack: error.stack,
    });
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

    // Step 1: Find and click the checkbox in the iframe
    logger?.info("📋 Step 1: Looking for reCAPTCHA checkbox...");

    await sleep(2000, "waiting for frames to load", logger);

    // Find the anchor frame (checkbox frame) with retries
    let anchorFrame = null;
    let attempts = 0;
    const maxAttempts = 3;

    while (!anchorFrame && attempts < maxAttempts) {
      attempts++;
      logger?.debug(
        `Attempt ${attempts}/${maxAttempts} to find anchor frame...`
      );

      try {
        const frames = page.frames();
        logger?.debug(`Found ${frames.length} total frames`);

        for (const frame of frames) {
          try {
            // Validate frame is still attached
            const frameUrl = frame.url();
            if (
              frameUrl &&
              frameUrl.includes("recaptcha") &&
              frameUrl.includes("anchor")
            ) {
              // Double-check frame is accessible
              await frame.evaluate(() => document.readyState);
              anchorFrame = frame;
              logger?.info(`Found anchor frame: ${frameUrl}`);
              break;
            }
          } catch (e) {
            // Skip detached or inaccessible frames
            logger?.debug(`Skipping detached frame: ${e.message}`);
          }
        }

        if (!anchorFrame && attempts < maxAttempts) {
          logger?.debug(`No anchor frame found, waiting and retrying...`);
          await sleep(2000, "waiting before retry", logger);
        }
      } catch (error) {
        logger?.warn(`Error during frame search: ${error.message}`);
        if (attempts < maxAttempts) {
          await sleep(2000, "waiting before retry", logger);
        }
      }
    }

    if (!anchorFrame) {
      logWithDedup(
        "warning",
        "⚠️ Could not find reCAPTCHA anchor frame",
        chalk.yellow,
        logger
      );
      return false;
    }

    // Click the checkbox with human-like movement if possible
    try {
      logger?.info("🖱️ Performing human-like checkbox interaction...");

      // Wait for checkbox to be ready
      await anchorFrame.waitForSelector(".recaptcha-checkbox-border", {
        timeout: 5000,
      });

      // Get page data for cursor
      const pageData = this?.pageData || { cursor: null };
      const cursor = pageData.cursor;

      const checkboxElement = await anchorFrame.$(".recaptcha-checkbox-border");

      if (checkboxElement && cursor && typeof cursor.click === "function") {
        // Use human-like clicking with ghost cursor
        try {
          await cursor.click(checkboxElement);
          logger?.info("✅ Ghost cursor clicked reCAPTCHA checkbox");
        } catch (cursorError) {
          // Fallback to direct click
          logger?.debug(
            `Ghost cursor failed: ${cursorError.message}, using fallback`
          );
          await anchorFrame.click(".recaptcha-checkbox-border");
          logger?.info("✅ Fallback click completed on checkbox");
        }
      } else {
        await anchorFrame.click(".recaptcha-checkbox-border");
        logger?.info("✅ Direct click on reCAPTCHA checkbox");
      }

      await sleep(3000, "waiting for challenge to appear", logger);
    } catch (error) {
      // Check if the error is because the element is already being interacted with
      if (
        error.message.includes("not clickable") ||
        error.message.includes("detached") ||
        error.message.includes("Target closed")
      ) {
        logger?.info("Checkbox might already be clicked by another handler");
        // Check if checkbox is already checked
        try {
          const isChecked = await anchorFrame.evaluate(() => {
            const checkbox = document.querySelector(".recaptcha-checkbox");
            return checkbox && checkbox.getAttribute("aria-checked") === "true";
          });
          if (isChecked) {
            logger?.info("✅ Checkbox is already checked");
            // Continue with the process
          }
        } catch (e) {
          // Frame might be detached, continue anyway
        }
      } else {
        logger?.error("Failed to click checkbox:", error.message);
        return false;
      }
    }

    // Step 2: Look for the challenge frame and click audio button
    logger?.info("📋 Step 2: Looking for challenge frame...");

    let challengeFrame = null;
    const updatedFrames = page.frames();

    for (const frame of updatedFrames) {
      try {
        const frameUrl = frame.url();
        if (frameUrl.includes("recaptcha") && frameUrl.includes("bframe")) {
          // Validate frame is accessible
          await frame.evaluate(() => document.readyState);
          challengeFrame = frame;
          logger?.info(`Found challenge frame: ${frameUrl}`);
          break;
        }
      } catch (e) {
        // Skip detached frames
        logger?.debug(`Skipping detached challenge frame: ${e.message}`);
      }
    }

    if (!challengeFrame) {
      logger?.warn(
        "⚠️ No challenge frame found - CAPTCHA might be solved already"
      );
      // Sometimes clicking the checkbox is enough
      const solved = await isCaptchaSolved(page, logger);
      if (solved) {
        logWithDedup(
          "success",
          "✅ CAPTCHA solved with just checkbox click!",
          chalk.green,
          logger
        );
        return true;
      }
      return false;
    }

    // Click audio button
    try {
      await sleep(2000, "waiting for challenge to load", logger);

      // Try multiple selectors for the audio button
      const audioSelectors = [
        "#recaptcha-audio-button",
        ".rc-button-audio",
        'button[aria-label*="audio"]',
        'button[title*="audio"]',
      ];

      let audioClicked = false;
      for (const selector of audioSelectors) {
        try {
          await challengeFrame.waitForSelector(selector, { timeout: 5000 });
          const audioElement = await challengeFrame.$(selector);

          if (audioElement) {
            const pageData = this?.pageData || { cursor: null };
            const cursor = pageData.cursor;

            if (cursor && typeof cursor.click === "function") {
              try {
                await cursor.click(audioElement);
                logger?.info(
                  `✅ Ghost cursor clicked audio button: ${selector}`
                );
                audioClicked = true;
                break;
              } catch (cursorError) {
                logger?.debug(
                  `Ghost cursor failed on audio button: ${cursorError.message}`
                );
                // Fallback to direct click
                await challengeFrame.click(selector);
                logger?.info(`✅ Fallback click on audio button: ${selector}`);
                audioClicked = true;
                break;
              }
            } else {
              await challengeFrame.click(selector);
              logger?.info(`✅ Direct click on audio button: ${selector}`);
              audioClicked = true;
              break;
            }
          }
        } catch (e) {
          logger?.debug(`Audio button not found with selector: ${selector}`);
        }
      }

      if (!audioClicked) {
        logger?.warn("⚠️ Could not find audio button");
        return false;
      }

      await sleep(3000, "waiting for audio challenge", logger);
    } catch (error) {
      logger?.error("Audio button interaction failed:", error.message);
      return false;
    }

    // Step 3: Find and download the audio
    logWithDedup(
      "info",
      "🎧 Step 3: Finding and transcribing audio",
      chalk.blue,
      logger
    );

    // Wait for audio source to appear - enhanced for headless mode
    let audioSrc = null;
    let audioAttempts = 0;
    const maxAudioAttempts = 5;

    while (!audioSrc && audioAttempts < maxAudioAttempts) {
      audioAttempts++;
      logger?.debug(`Audio source search attempt ${audioAttempts}/${maxAudioAttempts}`);

      try {
        // Wait longer for audio challenge to fully load in headless mode
        await waitForCaptchaChallenge(challengeFrame, logger, 8000);
        
        // Look for download link first
        try {
          await challengeFrame.waitForSelector(
            ".rc-audiochallenge-tdownload-link",
            { timeout: 8000 }
          );
          audioSrc = await challengeFrame.$eval(
            ".rc-audiochallenge-tdownload-link",
            (el) => el.href
          );
          logger?.info(`Found audio download link: ${audioSrc}`);
          break;
        } catch (e) {
          logger?.debug("Download link not found, trying other methods");
        }

        // Try audio element as fallback
        try {
          await challengeFrame.waitForSelector("#audio-source", { timeout: 5000 });
          const audioElement = await challengeFrame.$("#audio-source");
          if (audioElement) {
            audioSrc = await challengeFrame.$eval(
              "#audio-source",
              (el) => el.src
            );
            logger?.info(`Found audio source element: ${audioSrc}`);
            break;
          }
        } catch (error) {
          logger?.debug("Audio element not found either");
        }

        // Try more comprehensive selectors for headless mode
        try {
          audioSrc = await challengeFrame.evaluate(() => {
            // Enhanced selector list for better headless compatibility
            const selectors = [
              'a[href*="audio.mp3"]',
              'a[href*="recaptcha/api2/payload/audio.mp3"]',
              'a[download*="audio"]',
              '.rc-audiochallenge-tdownload-link',
              'audio source',
              'audio',
              'source[src*="audio"]',
              '[src*="audio.mp3"]',
              '[href*="audio.mp3"]'
            ];

            for (const selector of selectors) {
              const elements = document.querySelectorAll(selector);
              for (const el of elements) {
                const url = el.href || el.src;
                if (url && url.includes('audio')) {
                  return url;
                }
              }
            }

            // Look for any links or sources containing audio-related URLs
            const allLinks = document.querySelectorAll('a, audio, source');
            for (const el of allLinks) {
              const url = el.href || el.src;
              if (url && (url.includes('audio') || url.includes('payload'))) {
                return url;
              }
            }

            return null;
          });

          if (audioSrc) {
            logger?.info(`Found audio source with enhanced search: ${audioSrc}`);
            break;
          }
        } catch (evalError) {
          logger?.debug("Enhanced audio search failed:", evalError.message);
        }

        // Wait before next attempt
        if (audioAttempts < maxAudioAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

      } catch (error) {
        logger?.debug(`Audio search attempt ${audioAttempts} failed:`, error.message);
        if (audioAttempts < maxAudioAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    if (!audioSrc) {
      logWithDedup(
        "warning",
        "⚠️ Could not find audio source",
        chalk.yellow,
        logger
      );
      return false;
    }

    logger?.info(`📍 Audio URL: ${audioSrc}`);

    // Step 4: Transcribe the audio
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

    // Step 5: Enter the solution
    logWithDedup(
      "info",
      "📝 Step 4: Entering transcription",
      chalk.blue,
      logger
    );

    // Find and fill the audio response input
    const inputSelectors = [
      "#audio-response",
      'input[id*="audio"]',
      'input[name*="audio"]',
      ".rc-audiochallenge-response-field",
    ];

    let inputFilled = false;
    for (const selector of inputSelectors) {
      try {
        const input = await challengeFrame.$(selector);
        if (input) {
          await input.click();
          await input.type(solution);
          logger?.info(`Filled input with selector: ${selector}`);
          inputFilled = true;
          break;
        }
      } catch (e) {
        logger?.debug(`Input not found with selector: ${selector}`);
      }
    }

    if (!inputFilled) {
      logWithDedup(
        "warning",
        "⚠️ Could not find audio response input",
        chalk.yellow,
        logger
      );
      return false;
    }

    await waitForCaptchaElement(page, 'button[id*="verify"], .rc-audiochallenge-verify-button', logger, 2000);

    // Step 6: Submit the solution
    logWithDedup("info", "✔️ Step 5: Verifying solution", chalk.blue, logger);

    const verifySelectors = [
      "#recaptcha-verify-button",
      'button[id*="verify"]',
      ".rc-audiochallenge-verify-button",
    ];

    let verifyClicked = false;
    for (const selector of verifySelectors) {
      try {
        const verifyButton = await challengeFrame.$(selector);
        if (verifyButton) {
          await challengeFrame.click(selector);
          logger?.info(`Clicked verify button: ${selector}`);
          verifyClicked = true;
          break;
        }
      } catch (e) {
        logger?.debug(`Verify button not found with selector: ${selector}`);
      }
    }

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
      if (dashboard && dashboard.incrementCaptchaSolved) {
        dashboard.incrementCaptchaSolved();
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
      try {
        // Check if page is still valid
        await page.url();

        const frames = page.frames();
        const frame = frames.find((f) => {
          try {
            return f.url().includes("recaptcha") && f.url().includes(frameType);
          } catch (_frameError) {
            // Frame might be detached, skip it
            return false;
          }
        });

        if (frame) {
          // Verify frame is still accessible
          try {
            await frame.url();
            logger?.debug(`Found reCAPTCHA ${frameType} frame`);
            return frame;
          } catch (_frameError) {
            // Frame is detached, continue searching
            logger?.debug(`Found frame but it's detached, continuing search`);
          }
        }
      } catch (pageError) {
        if (
          pageError.message.includes("detached") ||
          pageError.message.includes("Target closed")
        ) {
          logger?.debug("Page is detached, stopping frame search");
          return null;
        }
        // Other errors, continue trying
      }

      await sleep(500, `waiting for ${frameType} frame`, logger);
    }

    logger?.warn(`Timeout waiting for reCAPTCHA ${frameType} frame`);
    return null;
  } catch (error) {
    if (
      error.message.includes("detached") ||
      error.message.includes("Target closed")
    ) {
      logger?.debug(`Page detached while waiting for ${frameType} frame`);
      return null;
    }

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
    // Check if frame is still valid
    await frame.url();

    const element = await frame.$(selector);
    if (element) {
      await element.click();
      logger?.debug(`Clicked element ${selector} in frame`);
      return true;
    }
    return false;
  } catch (error) {
    if (
      error.message.includes("detached") ||
      error.message.includes("Target closed") ||
      error.message.includes("Execution context was destroyed")
    ) {
      logger?.debug(`Frame detached while clicking element ${selector}`);
      return false;
    }

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
    // Check if frame is still valid
    await frame.url();

    await frame.waitForSelector(selector, { visible: true, timeout });
    const element = await frame.$(selector);
    if (element) {
      await element.click();
      logger?.debug(`Waited for and clicked element ${selector} in frame`);
      return true;
    }
    return false;
  } catch (error) {
    if (
      error.message.includes("detached") ||
      error.message.includes("Target closed") ||
      error.message.includes("Execution context was destroyed")
    ) {
      logger?.debug(
        `Frame detached while waiting/clicking element ${selector}`
      );
      return false;
    }

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
  transcribeWithElevenLabs, // added export
};
