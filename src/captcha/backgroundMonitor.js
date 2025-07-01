import { detectCaptcha } from "./detector.js";
import { sleep } from "../utils/sleep.js";
import chalk from "chalk";
import { logWithDedup } from "../utils/logger.js";
import { ELEVENLABS_CONFIG } from "../config/index.js";
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
   * Initialize ElevenLabs API for audio transcription
   */
  initializeElevenLabs() {
    if (ELEVENLABS_CONFIG.apiKey) {
      this.elevenLabsApiKey = ELEVENLABS_CONFIG.apiKey;
      this.logger?.debug(
        "ElevenLabs API initialized for audio transcription attempt"
      );
    } else {
      this.logger?.warn(
        "ElevenLabs API key not found in configuration - audio CAPTCHA solving will use fallback methods"
      );
    }
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

      // Check if page is still valid before CAPTCHA detection
      try {
        await page.url();
      } catch (error) {
        if (
          error.message.includes("detached") ||
          error.message.includes("Target closed")
        ) {
          this.logger?.debug(
            "Page is detached, skipping background CAPTCHA check"
          );
          return;
        }
        throw error;
      }

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
          this.dashboard.addLog("warning", "🚨 Background CAPTCHA detected!");
        }

        if (this.dashboard && this.dashboard.setCaptchaStats) {
          this.dashboard.setCaptchaStats(
            this.stats.captchasDetected,
            this.stats.captchasSolved
          );
        }

        // Set a flag to indicate CAPTCHA is being processed
        page._captchaBeingProcessed = true;

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
        // Clear the flag
        page._captchaBeingProcessed = false;
      }
    } catch (error) {
      // Handle detached frame errors gracefully
      if (
        error.message.includes("detached") ||
        error.message.includes("Target closed") ||
        error.message.includes("Execution context was destroyed")
      ) {
        this.logger?.debug(
          "Page or frame detached during background CAPTCHA monitoring, stopping check"
        );
        this.isProcessingCaptcha = false;
        return;
      }

      this.logger?.error("Error in background CAPTCHA monitoring", {
        error: error.message,
      });
      this.isProcessingCaptcha = false;
      // Clear the flag on error too
      if (this.pageData && this.pageData.page) {
        this.pageData.page._captchaBeingProcessed = false;
      }
    }
  }

  /**
   * Handle CAPTCHA automatically with full workflow
   */
  async handleCaptchaAutomatically() {
    try {
      const { page, cursor } = this.pageData;

      // Step 1: Find and click the checkbox in the iframe
      this.logger?.info("📋 Step 1: Looking for reCAPTCHA checkbox...");

      await sleep(2000, "waiting for frames to load", this.logger);

      // Find the anchor frame (checkbox frame) with retries
      let anchorFrame = null;
      let attempts = 0;
      const maxAttempts = 3;

      while (!anchorFrame && attempts < maxAttempts) {
        attempts++;
        this.logger?.debug(
          `Attempt ${attempts}/${maxAttempts} to find anchor frame...`
        );

        try {
          const frames = page.frames();
          this.logger?.debug(`Found ${frames.length} total frames`);

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
                this.logger?.info(`Found anchor frame: ${frameUrl}`);
                break;
              }
            } catch (e) {
              // Skip detached or inaccessible frames
              this.logger?.debug(`Skipping detached frame: ${e.message}`);
            }
          }

          if (!anchorFrame && attempts < maxAttempts) {
            this.logger?.debug(
              `No anchor frame found, waiting and retrying...`
            );
            await sleep(2000, "waiting before retry", this.logger);
          }
        } catch (error) {
          this.logger?.warn(`Error during frame search: ${error.message}`);
          if (attempts < maxAttempts) {
            await sleep(2000, "waiting before retry", this.logger);
          }
        }
      }

      if (!anchorFrame) {
        this.logger?.warn("Could not find reCAPTCHA anchor frame");
        return false;
      }

      // Click the checkbox with human-like movement if possible
      const checkboxClicked = await this.clickCaptchaCheckboxInFrame(
        anchorFrame,
        cursor
      );

      if (!checkboxClicked) {
        this.logger?.warn("Could not click CAPTCHA checkbox");
        // Don't immediately switch proxy - continue to try audio solving
        // The proxy switch should only happen after audio solving fails
      }

      // Wait for challenge to appear
      await sleep(3000, "waiting for CAPTCHA challenge", this.logger);

      // Step 2: Look for the challenge frame and click audio button
      this.logger?.info("📋 Step 2: Looking for challenge frame...");

      let challengeFrame = null;
      const updatedFrames = page.frames();

      for (const frame of updatedFrames) {
        try {
          const frameUrl = frame.url();
          if (frameUrl.includes("recaptcha") && frameUrl.includes("bframe")) {
            // Validate frame is accessible
            await frame.evaluate(() => document.readyState);
            challengeFrame = frame;
            this.logger?.info(`Found challenge frame: ${frameUrl}`);
            break;
          }
        } catch (e) {
          // Skip detached frames
          this.logger?.debug(`Skipping detached challenge frame: ${e.message}`);
        }
      }

      if (!challengeFrame) {
        this.logger?.warn(
          "No challenge frame found - CAPTCHA might be solved already"
        );
        // Sometimes clicking the checkbox is enough
        const stillHasCaptcha = await detectCaptcha(page, this.logger);
        if (!stillHasCaptcha) {
          this.logger?.info("✅ CAPTCHA solved with just checkbox click!");
          return true;
        }
        // Try proxy switch only if CAPTCHA still exists
        return await this.tryProxySwitch();
      }

      // Click audio button
      const audioButtonClicked = await this.clickAudioButtonInFrame(
        challengeFrame,
        cursor
      );

      if (!audioButtonClicked) {
        this.logger?.warn("Could not find audio CAPTCHA button");
        // Don't immediately switch proxy - continue anyway
      }

      // Wait for audio challenge to load
      await sleep(3000, "waiting for audio challenge", this.logger);

      // Step 3: Solve audio CAPTCHA
      const solved = await this.solveAudioCaptchaInFrame(page, challengeFrame);

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
   * Click CAPTCHA checkbox in a specific frame
   */
  async clickCaptchaCheckboxInFrame(frame, cursor) {
    try {
      this.logger?.info("🖱️ Performing human-like checkbox interaction...");

      // Wait for checkbox to be ready
      await frame.waitForSelector(".recaptcha-checkbox-border", {
        timeout: 5000,
      });

      const checkboxElement = await frame.$(".recaptcha-checkbox-border");

      if (checkboxElement && cursor && typeof cursor.click === "function") {
        // Use human-like clicking with ghost cursor
        try {
          await cursor.click(checkboxElement);
          this.logger?.info("✅ Ghost cursor clicked reCAPTCHA checkbox");
        } catch (cursorError) {
          // Fallback to direct click
          this.logger?.debug(
            `Ghost cursor failed: ${cursorError.message}, using fallback`
          );
          await frame.click(".recaptcha-checkbox-border");
          this.logger?.info("✅ Fallback click completed on checkbox");
        }
      } else {
        await frame.click(".recaptcha-checkbox-border");
        this.logger?.info("✅ Direct click on reCAPTCHA checkbox");
      }

      return true;
    } catch (error) {
      // Check if the error is because the element is already being interacted with
      if (
        error.message.includes("not clickable") ||
        error.message.includes("detached") ||
        error.message.includes("Target closed")
      ) {
        this.logger?.info(
          "Checkbox might already be clicked by another handler"
        );
        // Check if checkbox is already checked
        try {
          const isChecked = await frame.evaluate(() => {
            const checkbox = document.querySelector(".recaptcha-checkbox");
            return checkbox && checkbox.getAttribute("aria-checked") === "true";
          });
          if (isChecked) {
            this.logger?.info("✅ Checkbox is already checked");
            return true;
          }
        } catch (e) {
          // Frame might be detached, continue anyway
        }
      }

      this.logger?.error("Error clicking CAPTCHA checkbox", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Click audio button in a specific frame
   */
  async clickAudioButtonInFrame(frame, cursor) {
    try {
      await sleep(2000, "waiting for challenge to load", this.logger);

      // Try multiple selectors for the audio button
      const audioSelectors = [
        "#recaptcha-audio-button",
        ".rc-button-audio",
        'button[aria-label*="audio"]',
        'button[title*="audio"]',
      ];

      for (const selector of audioSelectors) {
        try {
          await frame.waitForSelector(selector, { timeout: 5000 });
          const audioElement = await frame.$(selector);

          if (audioElement) {
            if (cursor && typeof cursor.click === "function") {
              try {
                await cursor.click(audioElement);
                this.logger?.info(
                  `✅ Ghost cursor clicked audio button: ${selector}`
                );
                return true;
              } catch (cursorError) {
                this.logger?.debug(
                  `Ghost cursor failed on audio button: ${cursorError.message}`
                );
                // Fallback to direct click
                await frame.click(selector);
                this.logger?.info(
                  `✅ Fallback click on audio button: ${selector}`
                );
                return true;
              }
            } else {
              await frame.click(selector);
              this.logger?.info(`✅ Direct click on audio button: ${selector}`);
              return true;
            }
          }
        } catch (e) {
          this.logger?.debug(
            `Audio button not found with selector: ${selector}`
          );
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
   * Solve audio CAPTCHA in a specific frame
   */
  async solveAudioCaptchaInFrame(page, challengeFrame) {
    try {
      this.logger?.info("🎵 Attempting to solve audio CAPTCHA");

      if (this.dashboard && this.dashboard.addLog) {
        this.dashboard.addLog("info", "🎵 Processing audio CAPTCHA");
      }

      // Find audio source
      let audioSrc = null;

      try {
        // Look for download link
        await challengeFrame.waitForSelector(
          ".rc-audiochallenge-tdownload-link",
          { timeout: 10000 }
        );
        audioSrc = await challengeFrame.$eval(
          ".rc-audiochallenge-tdownload-link",
          (el) => el.href
        );
        this.logger?.info(`Found audio download link: ${audioSrc}`);
      } catch (e) {
        this.logger?.debug("Download link not found, trying audio element");

        // Try audio element as fallback
        try {
          const audioElement = await challengeFrame.$("#audio-source");
          if (audioElement) {
            audioSrc = await challengeFrame.$eval(
              "#audio-source",
              (el) => el.src
            );
            this.logger?.info(`Found audio source element: ${audioSrc}`);
          }
        } catch (error) {
          this.logger?.debug("Audio element not found either");
        }
      }

      if (!audioSrc) {
        // Try more generic selectors
        try {
          audioSrc = await challengeFrame.evaluate(() => {
            // Look for any audio.mp3 links
            const audioLinks = Array.from(
              document.querySelectorAll('a[href*="audio.mp3"]')
            );
            for (const link of audioLinks) {
              if (link.href) {
                return link.href;
              }
            }

            // Look for audio elements
            const audio = document.querySelector("audio");
            return audio ? audio.src : null;
          });
        } catch (evalError) {
          this.logger?.debug("Generic audio search failed:", evalError.message);
        }
      }

      if (!audioSrc) {
        this.logger?.warn("Could not find audio source for CAPTCHA");
        return false;
      }

      this.logger?.info(`📍 Audio URL: ${audioSrc}`);

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
      const success = await this.enterCaptchaSolutionInFrame(
        challengeFrame,
        transcription
      );

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
   * Enter CAPTCHA solution in a specific frame
   */
  async enterCaptchaSolutionInFrame(frame, solution) {
    try {
      const inputSelectors = [
        "#audio-response",
        'input[id*="audio"]',
        'input[name*="audio"]',
        ".rc-audiochallenge-response-field",
      ];

      // Find and fill the audio response input
      let inputFilled = false;
      for (const selector of inputSelectors) {
        try {
          const input = await frame.$(selector);
          if (input) {
            await input.click();
            await input.type(solution);
            this.logger?.info(`Filled input with selector: ${selector}`);
            inputFilled = true;
            break;
          }
        } catch (e) {
          this.logger?.debug(`Input not found with selector: ${selector}`);
        }
      }

      if (!inputFilled) {
        return false;
      }

      await sleep(1000, "after typing solution", this.logger);

      // Try to submit
      const verifySelectors = [
        "#recaptcha-verify-button",
        'button[id*="verify"]',
        ".rc-audiochallenge-verify-button",
      ];

      for (const selector of verifySelectors) {
        try {
          const verifyButton = await frame.$(selector);
          if (verifyButton) {
            await frame.click(selector);
            this.logger?.info(`Clicked verify button: ${selector}`);
            await sleep(3000, "after submitting solution", this.logger);
            return await this.verifyCaptchaSolved(frame.page());
          }
        } catch (e) {
          this.logger?.debug(
            `Verify button not found with selector: ${selector}`
          );
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
   * Download audio file
   */
  async downloadAudioFile(audioSrc) {
    try {
      this.logger?.info("📥 Starting audio file download...");
      this.logger?.debug("Download request details", {
        url: audioSrc,
        urlLength: audioSrc.length,
        domain: new URL(audioSrc).hostname,
      });

      const tempDir = path.join(process.cwd(), "temp");
      await fs.mkdir(tempDir, { recursive: true });

      const fileName = `captcha_audio_${Date.now()}.mp3`;
      const filePath = path.join(tempDir, fileName);

      this.logger?.info(`📁 Downloading to: ${filePath}`);

      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      };

      this.logger?.debug("Request headers", headers);

      const response = await axios({
        method: "GET",
        url: audioSrc,
        responseType: "stream",
        headers,
        timeout: 30000,
        maxRedirects: 5,
      });

      this.logger?.info("📡 Response received!");
      this.logger?.debug("Response details", {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        contentLength: response.headers["content-length"],
        contentType: response.headers["content-type"],
      });

      if (response.headers["content-length"]) {
        const fileSize = parseInt(response.headers["content-length"]);
        this.logger?.info(
          `📊 File size: ${fileSize} bytes (${(fileSize / 1024).toFixed(2)} KB)`
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
          this.logger?.debug(
            `Download progress: ${progress}% (${downloadedBytes} bytes)`
          );
        }
      });

      await pipeline(response.data, writer);

      // Get final file stats
      const stats = await fs.stat(filePath);
      this.logger?.info("✅ Audio file downloaded successfully!");
      this.logger?.debug("Final file details", {
        filePath,
        fileName,
        finalSize: stats.size,
        finalSizeKB: (stats.size / 1024).toFixed(2),
        downloadedBytes,
        created: stats.birthtime,
      });

      return filePath;
    } catch (error) {
      this.logger?.error("❌ Error downloading audio file", {
        error: error.message,
        stack: error.stack,
        code: error.code,
        url: audioSrc,
        response: error.response
          ? {
              status: error.response.status,
              statusText: error.response.statusText,
              headers: error.response.headers,
            }
          : null,
      });
      return null;
    }
  }

  /**
   * Transcribe audio using ElevenLabs API (using proper SDK)
   */
  async transcribeAudio(audioFilePath) {
    try {
      this.logger?.info("🎧 Starting audio transcription process...");
      this.logger?.debug("Transcription details", {
        audioFilePath,
        elevenLabsApiKeyAvailable: !!this.elevenLabsApiKey,
        apiKeyLength: this.elevenLabsApiKey ? this.elevenLabsApiKey.length : 0,
      });

      if (!this.elevenLabsApiKey) {
        this.logger?.warn(
          "No ElevenLabs API key available, using fallback transcription"
        );
        return await this.fallbackAudioTranscription(audioFilePath);
      }

      // Import ElevenLabs SDK
      const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");

      // Read the audio file
      this.logger?.info("📖 Reading audio file for transcription...");
      const audioBuffer = await fs.readFile(audioFilePath);
      const fileStats = await fs.stat(audioFilePath);

      this.logger?.debug("Audio file read details", {
        filePath: audioFilePath,
        bufferSize: audioBuffer.length,
        fileSize: fileStats.size,
        fileSizeKB: (fileStats.size / 1024).toFixed(2),
        created: fileStats.birthtime,
        modified: fileStats.mtime,
      });

      // Initialize ElevenLabs client
      this.logger?.info("🔧 Initializing ElevenLabs client...");
      const elevenlabs = new ElevenLabsClient({
        apiKey: this.elevenLabsApiKey,
      });

      // Create audio blob from buffer
      this.logger?.info("📦 Preparing audio blob for transcription...");
      const audioBlob = new Blob([audioBuffer], { type: "audio/mp3" });

      this.logger?.debug("Audio blob details", {
        size: audioBlob.size,
        type: audioBlob.type,
        blobSizeKB: (audioBlob.size / 1024).toFixed(2),
      });

      this.logger?.debug("Transcription request configuration", {
        modelId: "scribe_v1",
        tagAudioEvents: true,
        languageCode: "eng",
        diarize: false, // Set to false for CAPTCHA as it's usually single speaker
      });

      try {
        this.logger?.info("🌐 Sending transcription request to ElevenLabs...");

        // Use proper ElevenLabs SDK for speech-to-text
        const transcription = await elevenlabs.speechToText.convert({
          file: audioBlob,
          modelId: "scribe_v1", // Model to use, for now only "scribe_v1" is supported
          tagAudioEvents: true, // Tag audio events like laughter, applause, etc.
          languageCode: "eng", // Language of the audio file
          diarize: false, // Whether to annotate who is speaking (false for CAPTCHA)
        });

        this.logger?.info("📡 ElevenLabs transcription response received!");
        this.logger?.debug("Transcription response details", {
          responseType: typeof transcription,
          responseKeys:
            typeof transcription === "object"
              ? Object.keys(transcription)
              : null,
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

        this.logger?.debug("Transcription extraction", {
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
          this.logger?.info("✅ ElevenLabs transcription successful!", {
            transcription:
              transcriptionText.substring(0, 50) +
              (transcriptionText.length > 50 ? "..." : ""),
            fullLength: transcriptionText.length,
            fullText: transcriptionText,
          });
          return transcriptionText;
        } else {
          this.logger?.warn("⚠️ Empty transcription received from ElevenLabs");
          this.logger?.debug("Empty transcription analysis", {
            responseData: transcription,
            hasText: !!transcription?.text,
            hasTranscription: !!transcription?.transcription,
            isString: typeof transcription === "string",
          });
          return await this.fallbackAudioTranscription(audioFilePath);
        }
      } catch (apiError) {
        this.logger?.error("❌ ElevenLabs SDK transcription failed", {
          error: apiError.message,
          stack: apiError.stack,
          code: apiError.code,
          name: apiError.name,
          sdkError: true,
        });

        return await this.fallbackAudioTranscription(audioFilePath);
      }
    } catch (error) {
      this.logger?.error("❌ Error in transcribeAudio method", {
        error: error.message,
        stack: error.stack,
        audioFilePath,
        stage: "general_error",
      });

      // Fall back to alternative methods
      return await this.fallbackAudioTranscription(audioFilePath);
    }
  }

  /**
   * Fallback audio transcription using basic techniques
   */
  async fallbackAudioTranscription(audioFilePath) {
    try {
      this.logger?.debug("Using fallback audio transcription methods");

      // Try different fallback approaches

      // Method 1: Try a free online service (AssemblyAI free tier, etc.)
      const freeServiceResult = await this.tryFreeSTTService(audioFilePath);
      if (freeServiceResult) {
        return freeServiceResult;
      }

      // Method 2: Basic pattern recognition for simple CAPTCHAs
      // Some CAPTCHAs have predictable patterns or are simple number/letter sequences
      const patternResult = await this.tryPatternRecognition(audioFilePath);
      if (patternResult) {
        return patternResult;
      }

      this.logger?.warn("All fallback transcription methods failed");
      return null;
    } catch (error) {
      this.logger?.error("Error in fallback audio transcription", {
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Try using free speech-to-text services
   */
  async tryFreeSTTService(_audioFilePath) {
    try {
      // You could implement calls to services like:
      // - AssemblyAI free tier
      // - Mozilla DeepSpeech
      // - Wav2Vec2 models via HuggingFace

      this.logger?.debug("Free STT service integration not implemented");
      return null;
    } catch (error) {
      this.logger?.debug("Free STT service failed", { error: error.message });
      return null;
    }
  }

  /**
   * Try basic pattern recognition for simple CAPTCHAs
   */
  async tryPatternRecognition(_audioFilePath) {
    try {
      // For very simple CAPTCHAs, you might be able to:
      // 1. Analyze audio length to guess number of characters
      // 2. Use basic audio analysis to detect pauses between characters
      // 3. Pattern match against common CAPTCHA words/numbers

      this.logger?.debug(
        "Pattern recognition for CAPTCHA audio not implemented"
      );

      // This would require audio analysis libraries like node-wav, web-audio-api, etc.
      // For now, return null to maintain the existing proxy switching behavior
      return null;
    } catch (error) {
      this.logger?.debug("Pattern recognition failed", {
        error: error.message,
      });
      return null;
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

  // Deprecated methods - kept for backward compatibility
  /**
   * @deprecated Use clickCaptchaCheckboxInFrame instead
   */
  async clickCaptchaCheckbox(page, cursor) {
    // Try to find the anchor frame first
    const frames = page.frames();
    const anchorFrame = frames.find((frame) => {
      try {
        return (
          frame.url().includes("recaptcha") && frame.url().includes("anchor")
        );
      } catch (_frameError) {
        return false;
      }
    });

    if (anchorFrame) {
      return await this.clickCaptchaCheckboxInFrame(anchorFrame, cursor);
    }

    // Fallback to main page
    const checkboxElement = await page.$(".recaptcha-checkbox-border");
    if (checkboxElement) {
      return await this.clickCaptchaCheckboxInFrame(page, cursor);
    }

    return false;
  }

  /**
   * @deprecated Use clickAudioButtonInFrame instead
   */
  async clickAudioButton(page, cursor) {
    // Try to find the challenge frame first
    const frames = page.frames();
    const challengeFrame = frames.find((frame) => {
      try {
        return (
          frame.url().includes("recaptcha") && frame.url().includes("bframe")
        );
      } catch (_frameError) {
        return false;
      }
    });

    if (challengeFrame) {
      return await this.clickAudioButtonInFrame(challengeFrame, cursor);
    }

    return false;
  }

  /**
   * @deprecated Use solveAudioCaptchaInFrame instead
   */
  async solveAudioCaptcha(page) {
    // Try to find the challenge frame first
    const frames = page.frames();
    const challengeFrame = frames.find((frame) => {
      try {
        return (
          frame.url().includes("recaptcha") && frame.url().includes("bframe")
        );
      } catch (_frameError) {
        return false;
      }
    });

    if (challengeFrame) {
      return await this.solveAudioCaptchaInFrame(page, challengeFrame);
    }

    return false;
  }

  /**
   * @deprecated Use enterCaptchaSolutionInFrame instead
   */
  async enterCaptchaSolution(page, solution) {
    // Try to find the challenge frame first
    const frames = page.frames();
    const challengeFrame = frames.find((frame) => {
      try {
        return (
          frame.url().includes("recaptcha") && frame.url().includes("bframe")
        );
      } catch (_frameError) {
        return false;
      }
    });

    if (challengeFrame) {
      return await this.enterCaptchaSolutionInFrame(challengeFrame, solution);
    }

    return false;
  }
}

export default BackgroundCaptchaMonitor;
