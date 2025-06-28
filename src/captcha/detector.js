import chalk from "chalk";
import { logWithDedup } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";

/**
 * Detect if CAPTCHA is present on the page
 * @param {Object} page - Puppeteer page
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<boolean>} True if CAPTCHA detected
 */
async function detectCaptcha(page, logger = null) {
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
          logger?.info(`CAPTCHA detected with selector: ${selector}`);
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
        logger?.info(`CAPTCHA detected in URL: ${currentUrl}`);
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
        logger?.info(`CAPTCHA detected in title: ${title}`);
        return true;
      }
    }

    // Check for specific Google messages
    const bodyText = await page.evaluate(() =>
      document.body.innerText.toLowerCase()
    );
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
        logger?.info(`CAPTCHA detected in page text with pattern: ${pattern}`);
        return true;
      }
    }

    logger?.debug("No CAPTCHA detected");
    return false;
  } catch (error) {
    logger?.error("Error during CAPTCHA detection", { error: error.message });
    // In case of error, assume no CAPTCHA to avoid false positives
    return false;
  }
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

    // Update dashboard
    if (dashboard) {
      dashboard.addLog("warning", "🚨 CAPTCHA detected!");
      const currentStats = dashboard.stats;
      dashboard.setCaptchaStats(
        currentStats.captchaEncounters + 1,
        currentStats.captchaSolved
      );
    }

    if (config.manualCaptchaMode) {
      const solved = await handleManualCaptcha(page, logger);
      if (solved && dashboard) {
        const currentStats = dashboard.stats;
        dashboard.setCaptchaStats(
          currentStats.captchaEncounters,
          currentStats.captchaSolved + 1
        );
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

      if (dashboard) {
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
        if (dashboard) {
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

        if (dashboard) {
          dashboard.addLog(
            "warning",
            "🔄 CAPTCHA solving failed, switching proxy..."
          );
        }

        // Try switching proxy and attempting again
        const proxyChanged = await switchProxyCallback();
        if (proxyChanged) {
          if (dashboard) {
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

            if (dashboard) {
              dashboard.addLog("success", "✅ Proxy switch resolved CAPTCHA!");
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

            if (dashboard) {
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
            if (retrySolved && dashboard) {
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

      if (solved && dashboard) {
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
    if (dashboard) {
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
    // First, try to find and click the audio challenge button
    const audioButtonSelectors = [
      "#recaptcha-audio-button",
      'button[id*="audio"]',
      'button[aria-label*="audio"]',
      'button[title*="audio"]',
      ".rc-button-audio",
      ".recaptcha-checkbox-borderless",
      'span[role="button"]',
    ];

    let audioButtonFound = false;

    for (const selector of audioButtonSelectors) {
      try {
        const audioButton = await page.$(selector);
        if (audioButton) {
          logger?.info(`Found audio button with selector: ${selector}`);
          await audioButton.click();
          await sleep(2000);
          audioButtonFound = true;
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    if (!audioButtonFound) {
      // Try to look for reCAPTCHA iframe and access audio button inside
      const recaptchaFrame = await page
        .frames()
        .find(
          (frame) =>
            frame.url().includes("recaptcha") && frame.url().includes("anchor")
        );

      if (recaptchaFrame) {
        try {
          await recaptchaFrame.click(".recaptcha-checkbox-border");
          await sleep(3000);

          // Now look for challenge frame
          const challengeFrame = await page
            .frames()
            .find(
              (frame) =>
                frame.url().includes("recaptcha") &&
                frame.url().includes("bframe")
            );

          if (challengeFrame) {
            // Click audio challenge button in challenge frame
            await challengeFrame.click("#recaptcha-audio-button");
            await sleep(2000);
            audioButtonFound = true;
            logger?.info("Found audio button in reCAPTCHA challenge frame");
          }
        } catch (e) {
          logger?.debug("Error accessing reCAPTCHA frame:", e.message);
        }
      }
    }

    if (!audioButtonFound) {
      logWithDedup(
        "warning",
        "⚠️ Could not find audio CAPTCHA button",
        chalk.yellow,
        logger
      );
      if (dashboard) {
        dashboard.addLog("warning", "⚠️ Could not find audio CAPTCHA button");
      }
      return false;
    }

    // Wait for audio challenge to load
    await sleep(3000);

    // Try to find and download the audio challenge
    const audioSrc = await page.evaluate(() => {
      // Look for audio elements
      const audioElements = Array.from(document.querySelectorAll("audio"));
      for (const audio of audioElements) {
        if (audio.src && audio.src.includes("recaptcha")) {
          return audio.src;
        }
      }

      // Look in iframes
      const frames = Array.from(document.querySelectorAll("iframe"));
      for (const frame of frames) {
        try {
          const frameDoc =
            frame.contentDocument || frame.contentWindow.document;
          const frameAudio = frameDoc.querySelector("audio");
          if (frameAudio && frameAudio.src) {
            return frameAudio.src;
          }
        } catch (e) {
          // Cross-origin frame, skip
        }
      }

      return null;
    });

    if (!audioSrc) {
      // Try to find audio source in challenge frame
      const challengeFrame = await page
        .frames()
        .find(
          (frame) =>
            frame.url().includes("recaptcha") && frame.url().includes("bframe")
        );

      if (challengeFrame) {
        try {
          const frameAudioSrc = await challengeFrame.evaluate(() => {
            const audio = document.querySelector("audio");
            return audio ? audio.src : null;
          });

          if (frameAudioSrc) {
            // Process the audio and solve CAPTCHA
            const solution = await solveAudioCaptcha(frameAudioSrc, logger);
            if (solution) {
              // Enter the solution
              const inputField = await challengeFrame.$("#audio-response");
              if (inputField) {
                await inputField.type(solution);
                await sleep(1000);

                // Submit the solution
                const submitButton = await challengeFrame.$(
                  "#recaptcha-verify-button"
                );
                if (submitButton) {
                  await submitButton.click();
                  await sleep(3000);

                  // Check if CAPTCHA was solved
                  const solved = !(await detectCaptcha(page, logger));
                  if (solved) {
                    logWithDedup(
                      "success",
                      "✅ Audio CAPTCHA solved successfully!",
                      chalk.green,
                      logger
                    );
                  }
                  return solved;
                }
              }
            }
          }
        } catch (e) {
          logger?.debug(
            "Error processing audio in challenge frame:",
            e.message
          );
        }
      }

      logWithDedup(
        "warning",
        "⚠️ Could not find audio source for CAPTCHA",
        chalk.yellow,
        logger
      );
      if (dashboard) {
        dashboard.addLog(
          "warning",
          "⚠️ Could not find audio source for CAPTCHA"
        );
      }
      return false;
    }

    // Process the audio and solve CAPTCHA
    const solution = await solveAudioCaptcha(audioSrc, logger);
    if (!solution) {
      return false;
    }

    // Find input field and enter solution
    const inputField =
      (await page.$("#audio-response")) ||
      (await page.$('input[id*="audio"]')) ||
      (await page.$('input[type="text"]'));

    if (!inputField) {
      logWithDedup(
        "warning",
        "⚠️ Could not find CAPTCHA input field",
        chalk.yellow,
        logger
      );
      if (dashboard) {
        dashboard.addLog("warning", "⚠️ Could not find CAPTCHA input field");
      }
      return false;
    }

    await inputField.type(solution);
    await sleep(1000);

    // Submit solution
    const submitButton =
      (await page.$("#recaptcha-verify-button")) ||
      (await page.$('button[type="submit"]')) ||
      (await page.$('input[type="submit"]'));

    if (submitButton) {
      await submitButton.click();
      await sleep(3000);
    }

    // Verify CAPTCHA was solved
    const solved = !(await detectCaptcha(page, logger));

    if (solved) {
      logWithDedup(
        "success",
        "✅ Audio CAPTCHA solved successfully!",
        chalk.green,
        logger
      );
      if (dashboard) {
        dashboard.addLog("success", "✅ Audio CAPTCHA solved successfully!");
      }
    } else {
      logWithDedup(
        "warning",
        "⚠️ Audio CAPTCHA solution was incorrect",
        chalk.yellow,
        logger
      );
      if (dashboard) {
        dashboard.addLog("warning", "⚠️ Audio CAPTCHA solution was incorrect");
      }
    }

    return solved;
  } catch (error) {
    logger?.error("Error in automatic CAPTCHA handling", {
      error: error.message,
    });
    logWithDedup(
      "error",
      "❌ Automatic CAPTCHA solving failed",
      chalk.red,
      logger
    );
    if (dashboard) {
      dashboard.addLog("error", "❌ Automatic CAPTCHA solving failed");
    }
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

    // This is a simplified version - in production you'd want to:
    // 1. Download the audio file
    // 2. Convert it to the right format
    // 3. Send it to a speech recognition service (OpenAI Whisper, Google Speech-to-Text, etc.)
    // 4. Return the recognized text

    // For now, return null to indicate audio solving is not implemented
    // This will trigger the proxy switching fallback
    logWithDedup(
      "warning",
      "⚠️ Audio CAPTCHA solving not implemented yet - falling back to proxy switch",
      chalk.yellow,
      logger
    );

    return null;
  } catch (error) {
    logger?.error("Error solving audio CAPTCHA", { error: error.message });
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
};
