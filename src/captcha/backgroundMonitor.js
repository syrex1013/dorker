import { detectCaptcha } from "./detector.js";
import { sleep } from "../utils/sleep.js";
import chalk from "chalk";
import { logWithDedup } from "../utils/logger.js";
// ElevenLabs integration placeholder - can be implemented later
// import pkg from '@elevenlabs/elevenlabs-js';
// const { ElevenLabsApi } = pkg;
import fs from "fs/promises";
import path from "path";
import axios from "axios";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";

/**
 * Background CAPTCHA Monitor Class
 * Continuously monitors for CAPTCHAs and automatically solves them
 */
class BackgroundCaptchaMonitor {
  constructor(
    pageData,
    config,
    logger = null,
    dashboard = null,
    switchProxyCallback = null
  ) {
    this.pageData = pageData;
    this.config = config;
    this.logger = logger;
    this.dashboard = dashboard;
    this.switchProxyCallback = switchProxyCallback;

    // Monitor state
    this.isActive = false;
    this.monitorInterval = null;
    this.checkFrequency = 2000; // Check every 2 seconds
    this.isProcessingCaptcha = false;

    // ElevenLabs configuration (placeholder for future implementation)
    this.elevenLabs = null;
    this.initializeElevenLabs();

    // Statistics
    this.stats = {
      captchasDetected: 0,
      captchasSolved: 0,
      captchasFailed: 0,
      audioSolved: 0,
      proxySwitches: 0,
    };
  }

  /**
   * Initialize ElevenLabs API (placeholder for future implementation)
   */
  initializeElevenLabs() {
    // Placeholder for ElevenLabs integration
    // Can be implemented when ElevenLabs package is properly configured
    this.logger?.debug(
      "ElevenLabs integration placeholder - to be implemented"
    );
  }

  /**
   * Start background monitoring
   */
  start() {
    if (this.isActive) {
      this.logger?.debug("Background CAPTCHA monitor already running");
      return;
    }

    this.isActive = true;
    this.logger?.info("🔍 Starting background CAPTCHA monitor");

    if (this.dashboard && this.dashboard.addLog) {
      this.dashboard.addLog("info", "🔍 Background CAPTCHA monitor started");
    }

    // Start monitoring interval
    this.monitorInterval = setInterval(async () => {
      await this.checkForCaptcha();
    }, this.checkFrequency);

    logWithDedup(
      "info",
      "🛡️ Background CAPTCHA protection active",
      chalk.green,
      this.logger
    );
  }

  /**
   * Stop background monitoring
   */
  stop() {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    this.logger?.info("Background CAPTCHA monitor stopped");

    if (this.dashboard && this.dashboard.addLog) {
      this.dashboard.addLog("info", "⏹️ Background CAPTCHA monitor stopped");
    }

    logWithDedup(
      "info",
      "⏹️ Background CAPTCHA protection stopped",
      chalk.yellow,
      this.logger
    );
  }

  /**
   * Check for CAPTCHA and handle if found
   */
  async checkForCaptcha() {
    if (!this.isActive || this.isProcessingCaptcha) {
      return;
    }

    try {
      const { page } = this.pageData;

      // Quick CAPTCHA detection
      const captchaDetected = await detectCaptcha(page, this.logger);

      if (captchaDetected) {
        this.isProcessingCaptcha = true;
        this.stats.captchasDetected++;

        this.logger?.warn("🚨 Background monitor detected CAPTCHA!");
        logWithDedup(
          "warning",
          "🚨 CAPTCHA detected by background monitor!",
          chalk.red,
          this.logger
        );

        if (this.dashboard && this.dashboard.addLog) {
          this.dashboard.addLog("warning", "�� Background CAPTCHA detected!");
        }

        if (this.dashboard && this.dashboard.setCaptchaStats) {
          this.dashboard.setCaptchaStats(
            this.stats.captchasDetected,
            this.stats.captchasSolved
          );
        }

        // Handle the CAPTCHA
        const solved = await this.handleCaptchaAutomatically();

        if (solved) {
          this.stats.captchasSolved++;
          this.logger?.info(
            "✅ Background monitor solved CAPTCHA successfully"
          );
          logWithDedup(
            "success",
            "✅ Background CAPTCHA solved!",
            chalk.green,
            this.logger
          );

          if (this.dashboard && this.dashboard.addLog) {
            this.dashboard.addLog("success", "✅ Background CAPTCHA solved!");
          }

          if (this.dashboard && this.dashboard.setCaptchaStats) {
            this.dashboard.setCaptchaStats(
              this.stats.captchasDetected,
              this.stats.captchasSolved
            );
          }
        } else {
          this.stats.captchasFailed++;
          this.logger?.warn("❌ Background monitor failed to solve CAPTCHA");

          if (this.dashboard && this.dashboard.addLog) {
            this.dashboard.addLog(
              "error",
              "❌ Background CAPTCHA solving failed"
            );
          }
        }

        this.isProcessingCaptcha = false;
      }
    } catch (error) {
      this.logger?.error("Error in background CAPTCHA monitoring", {
        error: error.message,
      });
      this.isProcessingCaptcha = false;
    }
  }

  /**
   * Handle CAPTCHA automatically with full workflow
   */
  async handleCaptchaAutomatically() {
    try {
      const { page, cursor } = this.pageData;

      // Step 1: Try to find and click the CAPTCHA checkbox
      const checkboxClicked = await this.clickCaptchaCheckbox(page, cursor);

      if (!checkboxClicked) {
        this.logger?.warn("Could not find CAPTCHA checkbox");
        return await this.tryProxySwitch();
      }

      // Wait for challenge to appear
      await sleep(3000, "waiting for CAPTCHA challenge", this.logger);

      // Step 2: Try to click audio button
      const audioButtonClicked = await this.clickAudioButton(page, cursor);

      if (!audioButtonClicked) {
        this.logger?.warn("Could not find audio CAPTCHA button");
        return await this.tryProxySwitch();
      }

      // Wait for audio challenge to load
      await sleep(3000, "waiting for audio challenge", this.logger);

      // Step 3: Solve audio CAPTCHA
      const solved = await this.solveAudioCaptcha(page);

      if (solved) {
        this.stats.audioSolved++;
        return true;
      }

      // If audio solving failed, try proxy switch
      return await this.tryProxySwitch();
    } catch (error) {
      this.logger?.error("Error in automatic CAPTCHA handling", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Click CAPTCHA checkbox
   */
  async clickCaptchaCheckbox(page, cursor) {
    try {
      // Multiple strategies to find and click CAPTCHA checkbox
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
            this.logger?.debug(
              `Found CAPTCHA checkbox with selector: ${selector}`
            );

            // Try ghost cursor click
            try {
              await cursor.click(checkbox);
              this.logger?.debug("Ghost cursor clicked CAPTCHA checkbox");
            } catch (cursorError) {
              this.logger?.debug("Cursor click failed, using fallback", {
                error: cursorError.message,
              });
              await checkbox.click();
              this.logger?.debug(
                "Fallback click completed on CAPTCHA checkbox"
              );
            }

            await sleep(2000, "after checkbox click", this.logger);
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
                this.logger?.debug(
                  `Found CAPTCHA checkbox in iframe with selector: ${selector}`
                );
                await recaptchaFrame.click(selector);
                await sleep(2000, "after iframe checkbox click", this.logger);
                return true;
              }
            } catch (e) {
              // Continue
            }
          }
        } catch (frameError) {
          this.logger?.debug("Error accessing reCAPTCHA frame", {
            error: frameError.message,
          });
        }
      }

      return false;
    } catch (error) {
      this.logger?.error("Error clicking CAPTCHA checkbox", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Click audio button
   */
  async clickAudioButton(page, cursor) {
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
            this.logger?.debug(`Found audio button with selector: ${selector}`);

            try {
              await cursor.click(audioButton);
              this.logger?.debug("Ghost cursor clicked audio button");
            } catch (cursorError) {
              this.logger?.debug("Cursor click failed, using fallback", {
                error: cursorError.message,
              });
              await audioButton.click();
              this.logger?.debug("Fallback click completed on audio button");
            }

            await sleep(2000, "after audio button click", this.logger);
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
                this.logger?.debug(
                  `Found audio button in challenge frame with selector: ${selector}`
                );
                await challengeFrame.click(selector);
                await sleep(
                  2000,
                  "after iframe audio button click",
                  this.logger
                );
                return true;
              }
            } catch (e) {
              // Continue
            }
          }
        } catch (frameError) {
          this.logger?.debug("Error accessing challenge frame", {
            error: frameError.message,
          });
        }
      }

      return false;
    } catch (error) {
      this.logger?.error("Error clicking audio button", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Solve audio CAPTCHA
   */
  async solveAudioCaptcha(page) {
    try {
      this.logger?.info("🎵 Attempting to solve audio CAPTCHA");

      if (this.dashboard && this.dashboard.addLog) {
        this.dashboard.addLog("info", "🎵 Processing audio CAPTCHA");
      }

      // Find audio source
      const audioSrc = await this.findAudioSource(page);

      if (!audioSrc) {
        this.logger?.warn("Could not find audio source for CAPTCHA");
        return false;
      }

      this.logger?.debug("Found audio source", {
        audioSrc: audioSrc.substring(0, 100) + "...",
      });

      // Download audio file
      const audioFilePath = await this.downloadAudioFile(audioSrc);

      if (!audioFilePath) {
        this.logger?.warn("Failed to download audio file");
        return false;
      }

      // Convert audio to text using ElevenLabs or fallback
      const transcription = await this.transcribeAudio(audioFilePath);

      if (!transcription) {
        this.logger?.warn("Failed to transcribe audio");
        return false;
      }

      this.logger?.info("Audio transcribed successfully", { transcription });

      // Enter the solution
      const success = await this.enterCaptchaSolution(page, transcription);

      // Cleanup audio file
      try {
        await fs.unlink(audioFilePath);
      } catch (e) {
        // Ignore cleanup errors
      }

      return success;
    } catch (error) {
      this.logger?.error("Error solving audio CAPTCHA", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Find audio source URL
   */
  async findAudioSource(page) {
    try {
      // Try main page first
      let audioSrc = await page.evaluate(() => {
        const audioElements = Array.from(document.querySelectorAll("audio"));
        for (const audio of audioElements) {
          if (
            audio.src &&
            (audio.src.includes("recaptcha") || audio.src.includes("captcha"))
          ) {
            return audio.src;
          }
        }
        return null;
      });

      if (audioSrc) {
        return audioSrc;
      }

      // Try challenge iframe
      const challengeFrame = page
        .frames()
        .find(
          (frame) =>
            frame.url().includes("recaptcha") && frame.url().includes("bframe")
        );

      if (challengeFrame) {
        audioSrc = await challengeFrame.evaluate(() => {
          const audio = document.querySelector("audio");
          return audio ? audio.src : null;
        });
      }

      return audioSrc;
    } catch (error) {
      this.logger?.error("Error finding audio source", {
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Download audio file
   */
  async downloadAudioFile(audioSrc) {
    try {
      const tempDir = path.join(process.cwd(), "temp");
      await fs.mkdir(tempDir, { recursive: true });

      const fileName = `captcha_audio_${Date.now()}.mp3`;
      const filePath = path.join(tempDir, fileName);

      const response = await axios({
        method: "GET",
        url: audioSrc,
        responseType: "stream",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      });

      const writer = createWriteStream(filePath);
      await pipeline(response.data, writer);

      this.logger?.debug("Audio file downloaded", { filePath });
      return filePath;
    } catch (error) {
      this.logger?.error("Error downloading audio file", {
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Transcribe audio using ElevenLabs or fallback methods
   */
  async transcribeAudio(_audioFilePath) {
    try {
      // Note: ElevenLabs primarily does text-to-speech, not speech-to-text
      // For speech-to-text, we might need to use a different service
      // This is a placeholder for the actual implementation
      this.logger?.debug("Speech-to-text integration placeholder");

      // Fallback: Use a simple pattern matching approach for common CAPTCHA audio
      // This is a simplified approach - in production you'd want to use proper STT services
      const transcription = await this.fallbackAudioTranscription(
        _audioFilePath
      );

      return transcription;
    } catch (error) {
      this.logger?.error("Error transcribing audio", { error: error.message });
      return null;
    }
  }

  /**
   * Fallback audio transcription (placeholder)
   */
  async fallbackAudioTranscription(_audioFilePath) {
    try {
      // This is a placeholder implementation
      // In a real scenario, you'd integrate with:
      // - OpenAI Whisper API
      // - Google Speech-to-Text
      // - Azure Speech Services
      // - AWS Transcribe

      this.logger?.debug(
        "Using fallback audio transcription (limited functionality)"
      );

      // For now, return null to trigger proxy switching
      // You can implement actual STT service integration here
      return null;
    } catch (error) {
      this.logger?.error("Error in fallback audio transcription", {
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Enter CAPTCHA solution
   */
  async enterCaptchaSolution(page, solution) {
    try {
      const inputSelectors = [
        "#audio-response",
        'input[id*="audio"]',
        'input[name*="audio"]',
        'input[type="text"]',
        ".rc-audiochallenge-response-field",
      ];

      // Try main page first
      for (const selector of inputSelectors) {
        try {
          const input = await page.$(selector);
          if (input) {
            this.logger?.debug(`Found input field with selector: ${selector}`);
            await input.click();
            await input.type(solution);
            await sleep(1000, "after typing solution", this.logger);

            // Try to submit
            const submitted = await this.submitCaptchaSolution(page);
            if (submitted) {
              return await this.verifyCaptchaSolved(page);
            }
          }
        } catch (e) {
          // Continue
        }
      }

      // Try challenge iframe
      const challengeFrame = page
        .frames()
        .find(
          (frame) =>
            frame.url().includes("recaptcha") && frame.url().includes("bframe")
        );

      if (challengeFrame) {
        for (const selector of inputSelectors) {
          try {
            const input = await challengeFrame.$(selector);
            if (input) {
              this.logger?.debug(
                `Found input field in iframe with selector: ${selector}`
              );
              await challengeFrame.type(selector, solution);
              await sleep(1000, "after typing solution in iframe", this.logger);

              // Try to submit in iframe
              const submitted = await this.submitCaptchaSolutionInFrame(
                challengeFrame
              );
              if (submitted) {
                return await this.verifyCaptchaSolved(page);
              }
            }
          } catch (e) {
            // Continue
          }
        }
      }

      return false;
    } catch (error) {
      this.logger?.error("Error entering CAPTCHA solution", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Submit CAPTCHA solution
   */
  async submitCaptchaSolution(page) {
    try {
      const submitSelectors = [
        "#recaptcha-verify-button",
        'button[id*="verify"]',
        'button[type="submit"]',
        'input[type="submit"]',
        ".rc-audiochallenge-verify-button",
      ];

      for (const selector of submitSelectors) {
        try {
          const submitButton = await page.$(selector);
          if (submitButton) {
            this.logger?.debug(
              `Found submit button with selector: ${selector}`
            );
            await submitButton.click();
            await sleep(3000, "after submitting solution", this.logger);
            return true;
          }
        } catch (e) {
          // Continue
        }
      }

      return false;
    } catch (error) {
      this.logger?.error("Error submitting CAPTCHA solution", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Submit CAPTCHA solution in iframe
   */
  async submitCaptchaSolutionInFrame(frame) {
    try {
      const submitSelectors = [
        "#recaptcha-verify-button",
        'button[id*="verify"]',
        'button[type="submit"]',
        'input[type="submit"]',
        ".rc-audiochallenge-verify-button",
      ];

      for (const selector of submitSelectors) {
        try {
          const submitButton = await frame.$(selector);
          if (submitButton) {
            this.logger?.debug(
              `Found submit button in iframe with selector: ${selector}`
            );
            await frame.click(selector);
            await sleep(
              3000,
              "after submitting solution in iframe",
              this.logger
            );
            return true;
          }
        } catch (e) {
          // Continue
        }
      }

      return false;
    } catch (error) {
      this.logger?.error("Error submitting CAPTCHA solution in iframe", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Verify CAPTCHA was solved
   */
  async verifyCaptchaSolved(page) {
    try {
      await sleep(2000, "waiting for CAPTCHA verification", this.logger);

      const captchaStillPresent = await detectCaptcha(page, this.logger);
      const solved = !captchaStillPresent;

      if (solved) {
        this.logger?.info("✅ CAPTCHA verification successful");
      } else {
        this.logger?.warn("❌ CAPTCHA still present after solution attempt");
      }

      return solved;
    } catch (error) {
      this.logger?.error("Error verifying CAPTCHA solution", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Try proxy switch as fallback
   */
  async tryProxySwitch() {
    try {
      if (this.switchProxyCallback) {
        this.logger?.info("🔄 Attempting proxy switch to bypass CAPTCHA");
        this.stats.proxySwitches++;

        if (this.dashboard && this.dashboard.addLog) {
          this.dashboard.addLog("info", "🔄 Switching proxy to bypass CAPTCHA");
        }

        const switched = await this.switchProxyCallback();

        if (switched) {
          await sleep(5000, "after proxy switch", this.logger);

          // Check if CAPTCHA is gone after proxy switch
          const { page } = this.pageData;
          const captchaStillPresent = await detectCaptcha(page, this.logger);

          if (!captchaStillPresent) {
            this.logger?.info("✅ Proxy switch resolved CAPTCHA");
            this.stats.captchasSolved++;
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      this.logger?.error("Error in proxy switch fallback", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Get monitoring statistics
   */
  getStats() {
    return {
      ...this.stats,
      isActive: this.isActive,
      isProcessing: this.isProcessingCaptcha,
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      captchasDetected: 0,
      captchasSolved: 0,
      captchasFailed: 0,
      audioSolved: 0,
      proxySwitches: 0,
    };
  }
}

export default BackgroundCaptchaMonitor;
