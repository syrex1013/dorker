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

            // Try ghost cursor click with enhanced validation
            try {
              const isValidCursor =
                cursor &&
                typeof cursor === "object" &&
                typeof cursor.click === "function";

              if (isValidCursor) {
                try {
                  await cursor.click(checkbox);
                  this.logger?.debug("Ghost cursor clicked CAPTCHA checkbox");
                } catch (clickError) {
                  // Check if it's a remoteObject error
                  if (clickError.message.includes("remoteObject")) {
                    this.logger?.debug(
                      "Ghost cursor remoteObject error on CAPTCHA checkbox, using fallback"
                    );
                    throw new Error("remoteObject not available");
                  }
                  throw clickError;
                }
              } else {
                throw new Error("Invalid cursor object");
              }
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
      const recaptchaFrame = page.frames().find((frame) => {
        try {
          return (
            frame.url().includes("recaptcha") && frame.url().includes("anchor")
          );
        } catch (_frameError) {
          // Frame might be detached, skip it
          return false;
        }
      });

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
              const isValidCursor =
                cursor &&
                typeof cursor === "object" &&
                typeof cursor.click === "function";

              if (isValidCursor) {
                try {
                  await cursor.click(audioButton);
                  this.logger?.debug("Ghost cursor clicked audio button");
                } catch (clickError) {
                  // Check if it's a remoteObject error
                  if (clickError.message.includes("remoteObject")) {
                    this.logger?.debug(
                      "Ghost cursor remoteObject error on audio button, using fallback"
                    );
                    throw new Error("remoteObject not available");
                  }
                  throw clickError;
                }
              } else {
                throw new Error("Invalid cursor object");
              }
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
      const challengeFrame = page.frames().find((frame) => {
        try {
          return (
            frame.url().includes("recaptcha") && frame.url().includes("bframe")
          );
        } catch (_frameError) {
          // Frame might be detached, skip it
          return false;
        }
      });

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
      this.logger?.info("🔍 Searching for audio CAPTCHA source...");

      // Try main page first - look for the download link instead of audio elements
      let audioSrc = await page.evaluate(() => {
        // Look for the download link that appears after clicking audio button
        const downloadLink = document.querySelector(
          ".rc-audiochallenge-tdownload-link"
        );
        if (downloadLink && downloadLink.href) {
          return downloadLink.href;
        }

        // Fallback: look for any link with audio.mp3 in href
        const audioLinks = Array.from(
          document.querySelectorAll('a[href*="audio.mp3"]')
        );
        for (const link of audioLinks) {
          if (
            link.href &&
            (link.href.includes("recaptcha") || link.href.includes("captcha"))
          ) {
            return link.href;
          }
        }

        // Legacy fallback: check for audio elements (less likely to work)
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

      this.logger?.debug(
        `Found ${await page.$$eval(
          'a[href*="audio.mp3"]',
          (links) => links.length
        )} audio download links on main page`
      );

      if (audioSrc) {
        this.logger?.info("🎵 Found audio source on main page!");
        this.logger?.info(`📍 Audio URL: ${audioSrc}`);
        this.logger?.debug("Audio source details", {
          url: audioSrc,
          length: audioSrc.length,
          domain: new URL(audioSrc).hostname,
          pathname: new URL(audioSrc).pathname,
          isDownloadLink: audioSrc.includes("payload/audio.mp3"),
          hasRecaptchaParams:
            audioSrc.includes("p=") && audioSrc.includes("k="),
        });
        return audioSrc;
      }

      this.logger?.info(
        "🔍 No audio found on main page, checking challenge iframe..."
      );

      // Try challenge iframe
      const challengeFrame = page.frames().find((frame) => {
        try {
          return (
            frame.url().includes("recaptcha") && frame.url().includes("bframe")
          );
        } catch (_frameError) {
          // Frame might be detached, skip it
          return false;
        }
      });

      if (challengeFrame) {
        let frameUrl;
        try {
          frameUrl = challengeFrame.url();
        } catch (_frameError) {
          frameUrl = "detached_frame";
        }

        this.logger?.debug("Found challenge iframe", {
          frameUrl,
        });

        audioSrc = await challengeFrame.evaluate(() => {
          // Look for download link in iframe
          const downloadLink = document.querySelector(
            ".rc-audiochallenge-tdownload-link"
          );
          if (downloadLink && downloadLink.href) {
            return downloadLink.href;
          }

          // Fallback: look for any audio.mp3 links
          const audioLinks = Array.from(
            document.querySelectorAll('a[href*="audio.mp3"]')
          );
          for (const link of audioLinks) {
            if (link.href) {
              return link.href;
            }
          }

          // Legacy fallback: audio elements
          const audio = document.querySelector("audio");
          return audio ? audio.src : null;
        });

        if (audioSrc) {
          this.logger?.info("🎵 Found audio source in challenge iframe!");
          this.logger?.info(`📍 Audio URL: ${audioSrc}`);
          this.logger?.debug("Audio source details from iframe", {
            url: audioSrc,
            length: audioSrc.length,
            domain: new URL(audioSrc).hostname,
            pathname: new URL(audioSrc).pathname,
            frameUrl: challengeFrame.url(),
            isDownloadLink: audioSrc.includes("payload/audio.mp3"),
            hasRecaptchaParams:
              audioSrc.includes("p=") && audioSrc.includes("k="),
          });
          return audioSrc;
        } else {
          this.logger?.warn("No audio download link found in challenge iframe");
        }
      } else {
        this.logger?.warn("No challenge iframe found");
      }

      this.logger?.error("❌ Could not find any audio source for CAPTCHA");
      return null;
    } catch (error) {
      this.logger?.error("Error finding audio source", {
        error: error.message,
        stack: error.stack,
      });
      return null;
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
      const challengeFrame = page.frames().find((frame) => {
        try {
          return (
            frame.url().includes("recaptcha") && frame.url().includes("bframe")
          );
        } catch (_frameError) {
          // Frame might be detached, skip it
          return false;
        }
      });

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
