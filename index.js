import fs from "fs/promises";
import path from "path";
// Using puppeteer-real-browser for better anti-detection
import { connect } from "puppeteer-real-browser";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
// import AnonymizeUAPlugin from "puppeteer-extra-plugin-anonymize-ua"; // Currently unused
import RecaptchaPlugin from "puppeteer-extra-plugin-recaptcha";
import HumanTypingPlugin from "puppeteer-extra-plugin-human-typing";
import chalk from "chalk";
import { Command } from "commander";
import cliProgress from "cli-progress";
import inquirer from "inquirer";
import { select } from "@inquirer/prompts";
import winston from "winston";
import axios from "axios";
// import { spawn } from "child_process"; // Currently unused
import { createWriteStream } from "fs";
// import { SpeechClient } from "@google-cloud/speech"; // Replaced with ElevenLabs
import getMP3Duration from "get-mp3-duration";
import dotenv from "dotenv";
import process from "process";
import randomUseragent from "random-useragent";
import { createCursor } from "ghost-cursor";
// Load environment variables
dotenv.config();

// --- Configuration Objects ---
const ASOCKS_CONFIG = {
  apiKey: process.env.ASOCKS_API_KEY || null, // Configure via environment variable
};

const OPENROUTER_CONFIG = {
  apiKey:
    process.env.OPENROUTER_API_KEY ||
    "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", // Configure via environment variable
};

// --- Proxy Management Functions ---
async function testAsocksAPI() {
  if (!ASOCKS_CONFIG.apiKey) {
    console.log(chalk.red("❌ No ASOCKS API key configured"));
    console.log(
      chalk.yellow("   Please set ASOCKS_API_KEY in your environment variables")
    );
    return false;
  }

  try {
    console.log(chalk.blue("🔍 Testing ASOCKS API connection..."));
    console.log(
      chalk.gray(`   API Key: ${ASOCKS_CONFIG.apiKey.substring(0, 8)}...`)
    );

    // Test API connectivity using plan info endpoint
    const response = await axios.get(
      `https://api.asocks.com/v2/plan/info?apiKey=${ASOCKS_CONFIG.apiKey}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 10000,
      }
    );

    if (response.data && response.data.success === true) {
      console.log(chalk.green("✅ ASOCKS API connection successful"));
      if (response.data.message?.tariffName) {
        console.log(chalk.gray(`   Plan: ${response.data.message.tariffName}`));
      }
      if (response.data.message?.expiredDate) {
        console.log(
          chalk.gray(`   Valid until: ${response.data.message.expiredDate}`)
        );
      }
      return true;
    } else {
      console.log(chalk.red("❌ ASOCKS API returned unsuccessful response"));
      console.log(
        chalk.gray(`   Response: ${JSON.stringify(response.data, null, 2)}`)
      );
      return false;
    }
  } catch (error) {
    console.log(chalk.red("❌ ASOCKS API connection failed"));
    console.log(chalk.gray(`   Error: ${error.message}`));
    if (error.response?.data) {
      console.log(
        chalk.gray(
          `   Response: ${JSON.stringify(error.response.data, null, 2)}`
        )
      );
    }
    return false;
  }
}

async function generateProxy() {
  // Check if we have a real proxy service configured
  if (!ASOCKS_CONFIG.apiKey) {
    logger?.debug("No proxy service configured - proxy generation disabled");
    console.log(
      chalk.yellow("⚠️ Proxy service not configured - skipping proxy switch")
    );
    return null;
  }

  try {
    logger?.debug("Attempting to generate proxy via ASOCKS API");
    console.log(chalk.blue("🌐 Generating new proxy via ASOCKS API..."));

    // ASOCKS API create-port endpoint
    const response = await axios.post(
      `https://api.asocks.com/v2/proxy/create-port?apiKey=${ASOCKS_CONFIG.apiKey}`,
      {
        country_code: "US",
        state: "New York",
        city: "New York",
        asn: 11,
        type_id: 1, // 1 = residential, 2 = datacenter
        proxy_type_id: 2, // 1 = HTTP, 2 = SOCKS5
        name: null,
        server_port_type_id: 1,
        count: 1,
        ttl: 1, // Time to live in days
        traffic_limit: 10, // GB limit
      },
      {
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 15000, // 15 second timeout for proxy creation
      }
    );

    // Log the full response for debugging
    logger?.info("ASOCKS API Response", {
      status: response.status,
      data: response.data,
    });

    if (
      response.data &&
      response.data.success === true &&
      response.data.data &&
      response.data.data.length > 0
    ) {
      const proxyData = response.data.data[0]; // Get first proxy from the array

      logger?.info("Successfully generated proxy via ASOCKS API", {
        server: proxyData.server,
        port: proxyData.port,
        id: proxyData.id,
        login: proxyData.login,
      });

      return {
        id: proxyData.id,
        host: proxyData.server,
        port: proxyData.port,
        username: proxyData.login,
        password: proxyData.password,
        type: "SOCKS5", // ASOCKS uses proxy_type_id: 2 for SOCKS5
      };
    } else {
      // Log the response for debugging if it doesn't match expected format
      console.log(chalk.yellow("📋 ASOCKS API response:"));
      console.log(chalk.gray(JSON.stringify(response.data, null, 2)));
      throw new Error(
        response.data?.message ||
          `API returned success: ${response.data?.success}, but no proxy data found`
      );
    }
  } catch (error) {
    logger?.error("Failed to generate proxy via ASOCKS API", {
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
    });

    if (error.response?.status === 401 || error.response?.status === 403) {
      console.log(
        chalk.red("❌ ASOCKS API authentication failed - check your API key")
      );
    } else if (error.response?.status === 429) {
      console.log(
        chalk.red("❌ ASOCKS API rate limit exceeded - try again later")
      );
    } else if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      console.log(
        chalk.red(
          "❌ Unable to connect to ASOCKS API - check your internet connection"
        )
      );
    } else if (error.response?.data) {
      console.log(
        chalk.red(`❌ ASOCKS API error: ${JSON.stringify(error.response.data)}`)
      );
    } else {
      console.log(chalk.red(`❌ ASOCKS API error: ${error.message}`));
    }

    console.log(chalk.yellow("⚠️ Falling back to manual CAPTCHA mode"));
    return null;
  }
}

async function deleteProxy(proxyId) {
  // Check if we have a real proxy service configured
  if (!ASOCKS_CONFIG.apiKey) {
    logger?.debug("No proxy service configured - skipping proxy deletion");
    return true;
  }

  try {
    logger?.debug("Attempting to delete proxy via ASOCKS API", { proxyId });
    console.log(chalk.blue(`🗑️ Deleting proxy ${proxyId} via ASOCKS API...`));

    // ASOCKS API delete-port endpoint
    const response = await axios.delete(
      `https://api.asocks.com/v2/proxy/delete-port?apiKey=${ASOCKS_CONFIG.apiKey}&id=${proxyId}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 10000, // 10 second timeout
      }
    );

    if (
      response.status === 200 ||
      response.status === 204 ||
      (response.data && response.data.success === true)
    ) {
      logger?.info("Successfully deleted proxy via ASOCKS API", { proxyId });
      console.log(chalk.green(`✅ Proxy ${proxyId} deleted successfully`));
      return true;
    } else {
      throw new Error(
        response.data?.message ||
          response.data?.error ||
          "Failed to delete proxy"
      );
    }
  } catch (error) {
    logger?.error("Failed to delete proxy via ASOCKS API", {
      error: error.message,
      proxyId,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
    });

    if (error.response?.status === 401 || error.response?.status === 403) {
      console.log(
        chalk.red("❌ ASOCKS API authentication failed during proxy deletion")
      );
    } else if (error.response?.status === 404) {
      console.log(
        chalk.yellow(`⚠️ Proxy ${proxyId} not found (may already be deleted)`)
      );
      return true; // Consider it successful if already deleted
    } else if (error.response?.data) {
      console.log(
        chalk.red(
          `❌ Failed to delete proxy ${proxyId}: ${JSON.stringify(
            error.response.data
          )}`
        )
      );
    } else {
      console.log(
        chalk.red(`❌ Failed to delete proxy ${proxyId}: ${error.message}`)
      );
    }

    // Don't fail the entire process if proxy deletion fails
    return false;
  }
}

// --- Enhanced Advanced Fingerprinting Utilities ---
const generateRandomFingerprint = () => {
  // Expanded random screen resolutions with more realistic variations
  const screens = [
    { width: 1920, height: 1080, deviceScaleFactor: 1 },
    { width: 1920, height: 1080, deviceScaleFactor: 1.25 },
    { width: 1920, height: 1080, deviceScaleFactor: 1.5 },
    { width: 2560, height: 1440, deviceScaleFactor: 1 },
    { width: 2560, height: 1440, deviceScaleFactor: 1.5 },
    { width: 3840, height: 2160, deviceScaleFactor: 1.5 },
    { width: 3840, height: 2160, deviceScaleFactor: 2 },
    { width: 1366, height: 768, deviceScaleFactor: 1 },
    { width: 1536, height: 864, deviceScaleFactor: 1.25 },
    { width: 1440, height: 900, deviceScaleFactor: 1 },
    { width: 1440, height: 900, deviceScaleFactor: 2 }, // Retina
    { width: 1680, height: 1050, deviceScaleFactor: 1 },
    { width: 1280, height: 800, deviceScaleFactor: 1 },
    { width: 1280, height: 720, deviceScaleFactor: 1 },
    // Add more modern resolutions
    { width: 2880, height: 1800, deviceScaleFactor: 2 }, // MacBook Pro 16"
    { width: 3456, height: 2234, deviceScaleFactor: 2 }, // MacBook Pro 14"
    { width: 2736, height: 1824, deviceScaleFactor: 2 }, // Surface Studio
    { width: 1920, height: 1200, deviceScaleFactor: 1 }, // 16:10 monitor
    { width: 3440, height: 1440, deviceScaleFactor: 1 }, // Ultrawide
    { width: 2560, height: 1080, deviceScaleFactor: 1 }, // Ultrawide 21:9
  ];

  // WebGL vendor/renderer pairs (real combinations)
  const webglData = [
    { vendor: "Intel Inc.", renderer: "Intel Iris OpenGL Engine" },
    { vendor: "Intel Inc.", renderer: "Intel HD Graphics 630" },
    { vendor: "Intel Inc.", renderer: "Intel UHD Graphics 630" },
    {
      vendor: "NVIDIA Corporation",
      renderer: "NVIDIA GeForce GTX 1050 Ti/PCIe/SSE2",
    },
    {
      vendor: "NVIDIA Corporation",
      renderer: "NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2",
    },
    {
      vendor: "NVIDIA Corporation",
      renderer: "NVIDIA GeForce RTX 2070 SUPER/PCIe/SSE2",
    },
    {
      vendor: "NVIDIA Corporation",
      renderer: "NVIDIA GeForce RTX 3060/PCIe/SSE2",
    },
    {
      vendor: "NVIDIA Corporation",
      renderer: "NVIDIA GeForce RTX 3070/PCIe/SSE2",
    },
    {
      vendor: "NVIDIA Corporation",
      renderer: "NVIDIA GeForce RTX 3080/PCIe/SSE2",
    },
    { vendor: "AMD", renderer: "AMD Radeon Pro 5500M OpenGL Engine" },
    { vendor: "AMD", renderer: "AMD Radeon RX 580 2048SP" },
    { vendor: "AMD", renderer: "AMD Radeon RX 6700 XT" },
    { vendor: "Apple", renderer: "Apple M1" },
    { vendor: "Apple", renderer: "Apple M1 Pro" },
    { vendor: "Apple", renderer: "Apple M2" },
  ];

  // Realistic language combinations
  const languages = [
    ["en-US", "en"],
    ["en-GB", "en"],
    ["en-US", "en", "es"],
    ["en-US", "en", "fr"],
    ["en-US", "en", "de"],
    ["en-AU", "en"],
    ["en-NZ", "en"],
    ["en-US", "en", "zh-CN"],
    ["en-US", "en", "ja"],
    ["en-US", "en", "ko"],
  ];

  // Enhanced platform specific user agents with more realistic variations
  const userAgents = {
    windows: [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
      "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ],
    mac: [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
      "Mozilla/5.0 (Macintosh; Apple M1 Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Apple M2 Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
    ],
    linux: [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
      "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
      "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
      "Mozilla/5.0 (X11; Fedora; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
    ],
  };

  // Timezone configurations
  const timezones = [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Phoenix",
    "America/Toronto",
    "America/Vancouver",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Amsterdam",
    "Europe/Rome",
    "Europe/Madrid",
    "Europe/Stockholm",
    "Asia/Tokyo",
    "Asia/Shanghai",
    "Asia/Hong_Kong",
    "Asia/Singapore",
    "Australia/Sydney",
    "Australia/Melbourne",
  ];

  // Select random values
  const screen = screens[Math.floor(Math.random() * screens.length)];
  const webgl = webglData[Math.floor(Math.random() * webglData.length)];
  const language = languages[Math.floor(Math.random() * languages.length)];
  const platform = ["windows", "mac", "linux"][Math.floor(Math.random() * 3)];
  const userAgent =
    userAgents[platform][
      Math.floor(Math.random() * userAgents[platform].length)
    ];
  const timezone = timezones[Math.floor(Math.random() * timezones.length)];

  // Generate realistic hardware concurrency based on platform
  const hardwareConcurrency =
    platform === "mac"
      ? [8, 10, 12, 16][Math.floor(Math.random() * 4)]
      : [4, 6, 8, 12, 16][Math.floor(Math.random() * 5)];

  // Generate realistic device memory (in GB)
  const deviceMemory = [4, 8, 16, 32][Math.floor(Math.random() * 4)];

  // Canvas fingerprinting variations
  const canvasVariations = [
    { noise: Math.random() * 0.001, textBaseline: "top" },
    { noise: Math.random() * 0.001, textBaseline: "bottom" },
    { noise: Math.random() * 0.001, textBaseline: "middle" },
    { noise: Math.random() * 0.001, textBaseline: "alphabetic" },
  ];
  const canvasVariation =
    canvasVariations[Math.floor(Math.random() * canvasVariations.length)];

  // Audio context fingerprinting variations
  const audioContextVariations = [
    { sampleRate: 44100, channelCount: 2 },
    { sampleRate: 48000, channelCount: 2 },
    { sampleRate: 44100, channelCount: 1 },
    { sampleRate: 48000, channelCount: 1 },
    { sampleRate: 96000, channelCount: 2 },
  ];
  const audioVariation =
    audioContextVariations[
      Math.floor(Math.random() * audioContextVariations.length)
    ];

  // Font list variations (realistic combinations)
  const fontVariations = [
    [
      "Arial",
      "Helvetica",
      "Times New Roman",
      "Courier New",
      "Verdana",
      "Georgia",
      "Palatino",
      "Garamond",
      "Bookman",
      "Comic Sans MS",
    ],
    [
      "Arial",
      "Helvetica",
      "Times New Roman",
      "Courier New",
      "Verdana",
      "Georgia",
      "Trebuchet MS",
      "Arial Black",
      "Impact",
    ],
    [
      "Arial",
      "Helvetica",
      "Times New Roman",
      "Courier New",
      "Verdana",
      "Georgia",
      "Lucida Console",
      "Lucida Sans Unicode",
    ],
    [
      "System Font",
      "Arial",
      "Helvetica",
      "SF Pro Display",
      "SF Pro Text",
      "Times New Roman",
      "Menlo",
      "Monaco",
    ], // Mac-like
    [
      "Segoe UI",
      "Arial",
      "Helvetica",
      "Times New Roman",
      "Calibri",
      "Cambria",
      "Consolas",
      "Verdana",
    ], // Windows-like
  ];
  const fonts =
    fontVariations[Math.floor(Math.random() * fontVariations.length)];

  // Plugin variations (realistic for modern browsers)
  const pluginVariations = [
    [], // Most modern browsers have no plugins
    ["PDF Viewer"], // Common built-in
    ["Chrome PDF Plugin", "Chrome PDF Viewer"], // Chrome-specific
    ["PDF Viewer", "Widevine Content Decryption Module"], // Netflix/DRM users
  ];
  const plugins =
    pluginVariations[Math.floor(Math.random() * pluginVariations.length)];

  // Battery status variations (if supported)
  const batteryVariations = [
    { charging: true, level: 0.8 + Math.random() * 0.2 },
    { charging: false, level: 0.2 + Math.random() * 0.6 },
    { charging: true, level: 0.9 + Math.random() * 0.1 },
    null, // Desktop/no battery
  ];
  const battery =
    batteryVariations[Math.floor(Math.random() * batteryVariations.length)];

  // Connection type variations
  const connectionTypes = ["4g", "wifi", "ethernet", "slow-2g", "2g", "3g"];
  const connection =
    connectionTypes[Math.floor(Math.random() * connectionTypes.length)];

  return {
    screen,
    webgl,
    languages: language,
    userAgent,
    platform:
      platform === "mac"
        ? "MacIntel"
        : platform === "linux"
        ? "Linux x86_64"
        : "Win32",
    timezone,
    hardwareConcurrency,
    deviceMemory,
    canvas: canvasVariation,
    audio: audioVariation,
    fonts,
    plugins,
    battery,
    connection,
    // Add unique session identifiers
    sessionId: Math.random().toString(36).substring(2, 15),
    touchSupport: Math.random() > 0.7, // 30% chance of touch support
    colorDepth: [24, 32][Math.floor(Math.random() * 2)],
    pixelDepth: [24, 32][Math.floor(Math.random() * 2)],
  };
};

// --- Utility Functions ---

/**
 * A simple delay function.
 * @param {number} ms - The number of milliseconds to wait.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Human-like Mouse Movement ---
// Note: Now using ghost-cursor throughout the application for realistic mouse movements
// This function is kept for backward compatibility but is no longer used
// async function humanLikeMoveAndClick(page, element, options = {}) {
//   const { clickCount = 1, delay = 100 } = options;

//   // Try to get cursor instance from page if available
//   if (page._ghostCursor) {
//     await page._ghostCursor.click(element);
//   } else {
//     // Fallback to the original implementation
//     const box = await element.boundingBox();
//     if (!box) {
//       throw new Error("Element not visible");
//     }

//     const startX = Math.random() * 500;
//     const startY = Math.random() * 500;
//     const endX = box.x + box.width / 2;
//     const endY = box.y + box.height / 2;

//     await page.mouse.move(startX, startY);
//     await page.mouse.move(endX, endY, {
//       steps: 20 + Math.floor(Math.random() * 10),
//     });

//     await element.click({ clickCount, delay });
//   }
// }

// --- Professional Logging Setup ---
const createLogger = async () => {
  // Ensure logs directory exists
  const logsDir = path.join(process.cwd(), "logs");
  try {
    await fs.mkdir(logsDir, { recursive: true });
  } catch (err) {
    // Directory might already exist, ignore error
    void err;
  }

  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || "info", // Default to info level, configurable via environment
    format: winston.format.combine(
      winston.format.timestamp({
        format: "YYYY-MM-DD HH:mm:ss",
      }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    defaultMeta: { service: "dorker" },
    transports: [
      // Error log file
      new winston.transports.File({
        filename: path.join(logsDir, "error.log"),
        level: "error",
        options: { flags: "w" },
        maxsize: 5242880, // 5MB
        maxFiles: 5,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
      }),
      // Combined log file
      new winston.transports.File({
        filename: path.join(logsDir, "combined.log"),
        options: { flags: "w" },
        maxsize: 5242880, // 5MB
        maxFiles: 5,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
      }),
      // Debug log file
      new winston.transports.File({
        filename: path.join(logsDir, "debug.log"),
        level: "debug",
        options: { flags: "w" },
        maxsize: 5242880, // 5MB
        maxFiles: 3,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
      }),
    ],
  });

  // Only add console logging in debug mode, not during normal operation
  if (process.env.DEBUG_LOGS === "true") {
    logger.add(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        ),
        level: "debug",
      })
    );
  }

  return logger;
};

// Initialize logger
let logger;
(async () => {
  logger = await createLogger();
})();

// --- Setup Puppeteer with Enhanced Stealth ---
// Configure stealth plugin with all evasions
const stealthPlugin = StealthPlugin();
// Enable all evasions
stealthPlugin.enabledEvasions.delete("user-agent-override"); // We'll handle this ourselves
stealthPlugin.enabledEvasions.delete("navigator.plugins"); // Can cause issues with some sites

// Add custom evasion for iframe detection (currently unused but kept for future use)
// const customEvasion = {
//   name: "custom.iframe",
//   fn: async (page) => {
//     await page.evaluateOnNewDocument(() => {
//       // Override iframe detection
//       Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
//         get: function () {
//           return window;
//         },
//       });
//     });
//   },
// };

// Use stealth plugin
puppeteer.use(stealthPlugin);

// Configure adblocker to be less aggressive (to avoid detection)
puppeteer.use(
  AdblockerPlugin({
    blockTrackers: true,
    blockTrackerAndAnnoyances: false, // Less aggressive
    useCache: false, // Don't cache to avoid detection patterns
  })
);

// Configure recaptcha plugin for automatic solving (optional)
puppeteer.use(
  RecaptchaPlugin({
    provider: {
      id: "2captcha",
      token: process.env.CAPTCHA_TOKEN || "", // Add your 2captcha token if you want automatic solving
    },
    visualFeedback: true, // Show visual feedback when solving
    throwOnError: false, // Don't throw errors, let manual handling take over
  })
);

// Configure human typing plugin
puppeteer.use(
  HumanTypingPlugin({
    minimumDelayInMs: 50,
    maximumDelayInMs: 150,
    typoChanceInPercent: 5,
    chanceToKeepATypoInPercent: 2,
  })
);

// --- Search Engine Configurations ---
const SEARCH_ENGINES = {
  google: {
    name: "Google",
    searchUrl: (query) =>
      `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`,
    resultSelectors: ["div.g", "div.tF2Cxc", "div.kvH3mc"],
    titleSelector: "h3",
    linkSelector: "a",
    descSelector: "div.VwiC3b, span.aCOpRe, div.s",
    captchaIndicators: ["unusual traffic", "captcha", "recaptcha"],
    waitTime: 2000, // Reduced wait time for optimization
  },
  bing: {
    name: "Bing",
    searchUrl: (query) =>
      `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    resultSelectors: ["li.b_algo"],
    titleSelector: "h2 a",
    linkSelector: "h2 a",
    descSelector: "p, .b_caption p",
    captchaIndicators: ["verification", "unusual activity"],
    waitTime: 1500, // Reduced wait time
  },
  duckduckgo: {
    name: "DuckDuckGo",
    searchUrl: (query) =>
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web`,
    resultSelectors: [
      'div[data-result="result"]',
      'article[data-testid="result"]',
      "div.result",
    ],
    titleSelector: 'h2 a, a[data-testid="result-title-a"]',
    linkSelector: 'h2 a, a[data-testid="result-title-a"]',
    descSelector: 'span[data-result="snippet"], div[data-result="snippet"]',
    captchaIndicators: ["blocked", "unusual"],
    waitTime: 2000, // Reduced wait time
  },
};

// Google-specific cookie consent JavaScript injection
const GOOGLE_CONSENT_SCRIPT = `
(function() {
  console.log('Dorker: Checking for Google consent modal...');
  
  // Common Google consent modal selectors
  const consentSelectors = [
    '#L2AGLb', // Known Google consent button ID - try this first
    'button[id="L2AGLb"]', // Alternative selector for the same button
    'button:contains("Zaakceptuj wszystko")', // Polish "Accept all"
    'button:contains("Accept all")',
    'button:contains("Zaakceptuj")', // Polish "Accept"
    'button:contains("I agree")',
    'button:contains("Accept")',
    'button[aria-label*="Accept"], button[aria-label*="accept"]',
    'div[role="dialog"] button[jsname]',
    'button[data-ved]:contains("Accept")',
    'button[data-ved]:contains("Zaakceptuj")',
    'form[action*="consent"] button[type="submit"]'
  ];
  
  let clicked = false;
  
  // Wait a bit for the consent modal to fully load
  setTimeout(() => {
    for (const selector of consentSelectors) {
      try {
        let elements;
        if (selector.includes(':contains')) {
          // Handle contains pseudo-selector manually
          const baseSelector = selector.split(':contains')[0];
          const containsText = selector.match(/:contains\\("([^"]+)"\\)/)[1];
          elements = Array.from(document.querySelectorAll(baseSelector)).filter(el => 
            el.textContent.toLowerCase().includes(containsText.toLowerCase())
          );
        } else {
          elements = document.querySelectorAll(selector);
        }
        
        if (elements.length > 0) {
          console.log('Dorker: Found consent button with selector:', selector);
          const button = elements[0];
          
          // Check if button is visible and clickable
          const rect = button.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            console.log('Dorker: Clicking consent button...', button.textContent);
            button.click();
            clicked = true;
            
            // Wait a moment for the click to take effect
            setTimeout(() => {
              console.log('Dorker: Consent button clicked successfully');
            }, 500);
            return; // Exit the loop after successful click
          } else {
            console.log('Dorker: Button found but not visible:', selector);
          }
        }
      } catch (e) {
        console.log('Dorker: Error with selector', selector, ':', e.message);
      }
    }
    
    if (!clicked) {
      console.log('Dorker: No consent button found after waiting');
    }
  }, 1000);
  
  if (clicked) {
    console.log('Dorker: Successfully clicked Google consent button');
    return true;
  } else {
    console.log('Dorker: No consent modal found or clickable');
    return false;
  }
})();
`;

// Realistic viewport configurations
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
];

const randomDelay = (min = 500, max = 2000) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

/**
 * Loads dorks from a specified file.
 * @param {string} filePath - The path to the dork file.
 * @returns {Promise<string[]>} A promise that resolves to an array of dorks.
 */
async function loadDorks(filePath) {
  try {
    logger?.info("Loading dorks from file", { filePath });
    const fullPath = path.resolve(filePath);
    const data = await fs.readFile(fullPath, "utf-8");
    const dorks = data
      .split("\n")
      .map((dork) => dork.trim())
      .filter((dork) => dork && !dork.startsWith("#"));

    logger?.info("Dorks loaded successfully", {
      count: dorks.length,
      filePath,
    });
    console.log(
      chalk.green(
        `[+] Loaded ${chalk.yellow(dorks.length)} dorks from ${chalk.cyan(
          filePath
        )}`
      )
    );
    return dorks;
  } catch (error) {
    logger?.error("Error loading dorks file", {
      filePath,
      error: error.message,
    });
    console.error(
      chalk.red(`[!] Error reading dork file at ${filePath}: ${error.message}`)
    );
    process.exit(1);
  }
}

/**
 * Saves the collected results to a JSON file.
 * @param {object} data - The data to save.
 * @param {string} filePath - The path to the output file.
 */
async function saveResults(data, filePath) {
  try {
    logger?.info("Saving results to file", {
      filePath,
      resultCount: Object.keys(data).length,
    });
    const fullPath = path.resolve(filePath);
    await fs.writeFile(fullPath, JSON.stringify(data, null, 2), "utf-8");
    logger?.info("Results saved successfully", { filePath: fullPath });
    console.log(
      chalk.green(`\n[+] Results saved successfully to ${chalk.cyan(fullPath)}`)
    );
  } catch (error) {
    logger?.error("Error saving results", { filePath, error: error.message });
    console.error(
      chalk.red(`[!] Error saving results to ${filePath}: ${error.message}`)
    );
  }
}

/**
 * Appends results for a single dork to the output file immediately
 * @param {string} dork - The dork query
 * @param {Array} results - The results for this dork
 * @param {string} filePath - The path to the output file
 * @param {object} allResults - All results collected so far
 */
async function appendDorkResults(dork, results, filePath, allResults) {
  if (!filePath || !results || results.length === 0) return;

  try {
    logger?.debug("Appending dork results to output file", {
      dork: dork.substring(0, 50),
      resultCount: results.length,
      filePath,
    });

    // Update the all results object
    allResults[dork] = results;

    // Save the updated results immediately
    const fullPath = path.resolve(filePath);
    await fs.writeFile(fullPath, JSON.stringify(allResults, null, 2), "utf-8");

    logger?.info("Dork results appended successfully", {
      dork: dork.substring(0, 50),
      resultCount: results.length,
      totalDorks: Object.keys(allResults).length,
    });
  } catch (error) {
    logger?.error("Error appending dork results", {
      dork: dork.substring(0, 50),
      error: error.message,
    });
  }
}

// --- Interactive Menu Functions ---
async function showWelcome() {
  console.clear();

  const banner = `
${"═".repeat(62)}
[36m[1m  █▀▀ ▄▀█ █▀▀ █▀█ █▀▄ █   ▀█▀  █▀▄ ▄▀█ █▀▄▀█ █▀▀ █▀  [0m
[36m[1m  █▄▄ █▀█ ██▄ █▀▀ █▄▀ █▄▄  █   █▄▀ █▀█ █ ▀ █ ██▄ ▄█  [0m
${"═".repeat(62)}
  [33mAdvanced Dorker v2.2 – Multi-Engine Search & CAPTCHA Assistant[0m
${"═".repeat(62)}
`;

  console.log(banner);
  console.log(chalk.greenBright("🚀 Welcome to the Advanced Dorker CLI!"));
  console.log(
    chalk.gray("   Professional Google Dorking with CAPTCHA & Proxy Support\n")
  );

  // Show configuration status
  console.log(chalk.blue("📋 Configuration Status:"));
  console.log(
    `   ${chalk.green("✓")} Environment: ${chalk.yellow(
      process.env.NODE_ENV || "development"
    )}`
  );

  // Show proxy API status without testing
  console.log(
    `   ${
      ASOCKS_CONFIG.apiKey ? chalk.green("✓") : chalk.red("✗")
    } Proxy API: ${
      ASOCKS_CONFIG.apiKey
        ? chalk.green("Configured")
        : chalk.red("Not configured")
    }`
  );

  console.log(
    `   ${chalk.green("✓")} Browser: ${chalk.green("Puppeteer with Stealth")}`
  );
  console.log(
    `   ${chalk.green("✓")} CAPTCHA: ${chalk.green("Audio solving enabled")}`
  );
  console.log();
}

async function getSearchEngineChoice() {
  console.log(chalk.cyanBright("🔍 Select Search Engine\n"));

  const engine = await select({
    message: "Which search engine would you like to use?",
    choices: [
      {
        name: `${chalk.redBright("●")} Google (Recommended)`,
        value: "google",
        description: "Most comprehensive results, advanced dorking features",
      },
      {
        name: `${chalk.blueBright("●")} Bing`,
        value: "bing",
        description: "Microsoft's search engine, good alternative",
      },
      {
        name: `${chalk.yellowBright("●")} DuckDuckGo`,
        value: "duckduckgo",
        description: "Privacy-focused search engine",
      },
    ],
    default: "google",
  });

  return engine;
}

async function getSettings() {
  const settings = await inquirer.prompt([
    {
      type: "number",
      name: "maxResults",
      message: "Max results per dork?",
      default: 10,
    },
    {
      type: "number",
      name: "delay",
      message: "Delay between dorks (ms)?",
      default: 3000,
    },
    {
      type: "confirm",
      name: "headless",
      message: "Run in headless (no GUI) mode?",
      default: true,
    },
    {
      type: "confirm",
      name: "autoSolve",
      message: "Enable automatic CAPTCHA solving (image & audio)?",
      default: true,
    },
    {
      type: "confirm",
      name: "useProxyOnCaptcha",
      message: `🌐 Use proxy when CAPTCHA is detected? ${
        !ASOCKS_CONFIG.apiKey
          ? chalk.red("(API key not configured)")
          : chalk.green("(API key ready)")
      }`,
      default: ASOCKS_CONFIG.apiKey ? false : false, // Disabled if no API key
    },
  ]);

  return settings;
}

// ... rest of the code ...

class MultiEngineDorker {
  constructor(options) {
    this.options = options;
    this.config = options;
    this.engine = SEARCH_ENGINES[options.engine];
    this.isGoogleEngine = this.engine.name === "Google";
    this.browser = null;
    this.page = null;
    this.googleConsentHandled = false;
    this.captchaCount = 0;
    this.currentProxy = null;
    this.userDataDir = null;
    this.proxiesUsed = [];
    this.proxyApiTested = false; // Track if we've tested the API connection yet
    this.fingerprint = generateRandomFingerprint();
    this.currentViewport = {
      width: this.fingerprint.screen.width,
      height: this.fingerprint.screen.height,
      deviceScaleFactor: this.fingerprint.screen.deviceScaleFactor,
    };
    // Audio download cache to prevent multiple downloads of the same file
    this.audioCache = new Map();
    // Track current dork for proxy switches
    this.currentDork = null;
    this.cursor = null; // For ghost-cursor

    if (!this.options.delay) {
      this.options.delay = this.engine.waitTime;
    }

    // Ensure autoSolve is defined
    if (typeof this.options.autoSolve === "undefined") {
      this.options.autoSolve = true;
    }

    // Set a realistic user agent
    this.userAgent = randomUseragent.getRandom();
  }

  async initialize() {
    try {
      logger?.info("Initializing browser with puppeteer-real-browser", {
        engine: this.engine.name,
        headless: this.options.headless,
      });

      console.log(chalk.blue("🚀 Initializing puppeteer-real-browser..."));

      // Create temporary user data directory for session isolation
      const tempDir = path.join(process.cwd(), "temp");
      await fs.mkdir(tempDir, { recursive: true });
      this.userDataDir = path.join(tempDir, `session_${Date.now()}`);

      // Additional args to pass to puppeteer-real-browser
      const additionalArgs = [
        "--window-size=1920,1080",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-features=TranslateUI",
        "--disable-translate",
        "--disable-ipc-flooding-protection",
        "--force-color-profile=srgb",
        "--memory-pressure-off",
        "--max_old_space_size=4096",
        // Dark mode / black theme flags
        "--force-dark-mode",
        "--enable-features=WebUIDarkMode",
        "--force-prefers-color-scheme=dark",
      ];

      // Configure proxy for puppeteer-real-browser
      let proxyConfig = null;
      if (this.currentProxy && this.currentProxy.host) {
        proxyConfig = {
          host: this.currentProxy.host,
          port: this.currentProxy.port,
          username: this.currentProxy.username || "",
          password: this.currentProxy.password || "",
        };
        console.log(
          chalk.blue(
            `🌐 Configuring proxy: ${this.currentProxy.host}:${this.currentProxy.port}`
          )
        );
        logger?.info("Browser launching with proxy configuration", {
          proxy: `${this.currentProxy.host}:${this.currentProxy.port}`,
          type: this.currentProxy.type,
        });
      }

      // Try puppeteer-real-browser first, fallback to regular puppeteer
      let browser, page;
      try {
        console.log(chalk.blue("🤖 Attempting puppeteer-real-browser..."));
        const connectConfig = {
          headless: this.options.headless === true ? "new" : false,
          args: [
            ...additionalArgs,
            "--enable-javascript",
            "--allow-running-insecure-content",
            "--disable-web-security",
            "--disable-features=VizDisplayCompositor",
            "--disable-site-isolation-trials",
            "--disable-extensions-except",
            "--disable-plugins-discovery",
            "--autoplay-policy=no-user-gesture-required",
          ],
          customConfig: {},
          turnstile: true, // Auto-solve Cloudflare Turnstile
          connectOption: {
            defaultViewport: null,
            ignoreHTTPSErrors: true,
            ignoreDefaultArgs: [
              "--enable-automation",
              "--enable-blink-features=IdleDetection",
            ],
          },
          disableXvfb: false,
          ignoreAllFlags: false,
        };

        // Only add proxy if it's properly configured
        if (proxyConfig && proxyConfig.host && proxyConfig.port) {
          connectConfig.proxy = proxyConfig;
        }

        const result = await connect(connectConfig);

        browser = result.browser;
        page = result.page;
        console.log(chalk.green("✅ Using puppeteer-real-browser"));
      } catch (realBrowserError) {
        console.log(
          chalk.yellow(
            "⚠️ puppeteer-real-browser failed, falling back to regular puppeteer"
          )
        );
        logger?.warn("puppeteer-real-browser failed, using fallback", {
          error: realBrowserError.message,
          stack: realBrowserError.stack,
          hasProxy: !!proxyConfig,
        });

        // Add proxy args if needed for regular puppeteer
        if (proxyConfig) {
          additionalArgs.push(
            `--proxy-server=socks5://${proxyConfig.host}:${proxyConfig.port}`
          );
        }
        additionalArgs.push(`--user-data-dir=${this.userDataDir}`);

        // Fallback to regular puppeteer
        browser = await puppeteer.launch({
          headless: this.options.headless,
          args: additionalArgs,
          ignoreDefaultArgs: ["--enable-automation"],
          ignoreHTTPSErrors: true,
          defaultViewport: null,
        });

        page = await browser.newPage();

        // Set proxy authentication if using regular puppeteer with proxy
        if (proxyConfig && proxyConfig.username && proxyConfig.password) {
          await page.authenticate({
            username: proxyConfig.username,
            password: proxyConfig.password,
          });
          console.log(chalk.blue(`🔐 Proxy authentication configured`));
        }

        console.log(chalk.green("✅ Using regular puppeteer"));
      }

      this.browser = browser;
      this.page = page;

      // Initialize ghost-cursor for realistic mouse movements
      this.cursor = createCursor(this.page);
      // Store cursor reference in page for use in humanLikeMoveAndClick
      this.page._ghostCursor = this.cursor;

      // Test ghost cursor functionality
      logger?.debug("Testing ghost cursor initialization");
      try {
        await this.cursor.moveTo({ x: 100, y: 100 });
        logger?.info("Ghost cursor initialized successfully");
      } catch (error) {
        logger?.warn("Ghost cursor initialization issue", {
          error: error.message,
        });
      }

      // Enable human typing on this page
      this.page.typeHuman = async (selector, text, options = {}) => {
        const element = await this.page.$(selector);
        if (!element) {
          throw new Error(`Element not found: ${selector}`);
        }

        // First move to the element with ghost cursor
        await this.cursor.click(selector);

        // Then type with human-like behavior
        const delay = options.delay || Math.random() * 100 + 50;
        for (let i = 0; i < text.length; i++) {
          await this.page.keyboard.type(text[i], { delay });

          // Occasionally pause longer between words
          if (text[i] === " " && Math.random() < 0.2) {
            await sleep(Math.random() * 200 + 100);
          }
        }
      };

      // Set viewport
      await this.page.setViewport(this.currentViewport);

      // Handle failed requests gracefully (removed request interception to prevent CORS conflicts)
      this.page.on("requestfailed", (request) => {
        const url = request.url();
        if (url.includes("recaptcha") || url.includes("gstatic.com")) {
          logger?.debug(
            "reCAPTCHA resource failed to load, this may be due to anti-detection",
            {
              url: url.substring(0, 100),
              failure: request.failure()?.errorText,
            }
          );
        }
      });

      // Set user agent from fingerprint - already handled by puppeteer-real-browser
      // await this.page.setUserAgent(this.fingerprint.userAgent);

      // Apply advanced fingerprinting
      await this.applyFingerprint();

      // Inject additional anti-detection scripts
      await this.page.evaluateOnNewDocument(() => {
        // Fix reCAPTCHA CORS issues by intercepting and modifying requests
        const originalFetch = window.fetch;
        window.fetch = function (...args) {
          const [_resource, config] = args;

          // Remove problematic headers that trigger CORS
          if (config && config.headers) {
            const headers = new Headers(config.headers);
            headers.delete("cache-control");
            headers.delete("pragma");
            headers.delete("expires");
            config.headers = headers;
          }

          return originalFetch.apply(this, args);
        };

        // Add missing reCAPTCHA functions to prevent JavaScript errors
        if (typeof window.solveSimpleChallenge === "undefined") {
          window.solveSimpleChallenge = function () {
            console.log("solveSimpleChallenge called");
            return true;
          };
        }

        // Add other missing reCAPTCHA globals
        window.recaptcha = window.recaptcha || {};
        window.grecaptcha = window.grecaptcha || {
          ready: function (cb) {
            setTimeout(cb, 100);
          },
          execute: function () {
            return Promise.resolve("mock-token");
          },
          render: function () {
            return "mock-widget-id";
          },
        };

        // Override XMLHttpRequest to handle CORS issues
        const originalXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function () {
          const xhr = new originalXHR();
          const originalSetRequestHeader = xhr.setRequestHeader;

          xhr.setRequestHeader = function (header, value) {
            // Skip problematic headers
            if (
              header.toLowerCase() === "cache-control" ||
              header.toLowerCase() === "pragma" ||
              header.toLowerCase() === "expires"
            ) {
              return;
            }
            return originalSetRequestHeader.call(this, header, value);
          };

          return xhr;
        };

        // Add missing functions that Google expects
        window.google = window.google || {};
        window.google.codesearch = window.google.codesearch || {};

        // Prevent detection of automation tools (check if already defined)
        if (!Object.prototype.hasOwnProperty.call(navigator, "webdriver")) {
          Object.defineProperty(navigator, "webdriver", {
            get: () => undefined,
          });
        } else {
          // If already defined, try to delete it first
          try {
            delete navigator.webdriver;
          } catch (e) {
            // If can't delete, override the descriptor
            try {
              Object.defineProperty(navigator, "webdriver", {
                get: () => undefined,
                configurable: true,
              });
            } catch (_e2) {
              // Last resort - just set it
              navigator.webdriver = undefined;
            }
          }
        }

        // Add realistic performance timing
        if (window.performance && window.performance.timing) {
          const timing = window.performance.timing;
          const now = Date.now();
          Object.defineProperty(timing, "navigationStart", {
            get: () => now - 1000,
          });
          Object.defineProperty(timing, "loadEventEnd", { get: () => now });
        }

        // Track errors for debugging
        window._recaptchaErrors = [];
        window._corsErrors = [];

        // Override console to catch reCAPTCHA errors
        const originalConsoleError = console.error;
        console.error = function (...args) {
          const message = args.join(" ");
          if (message.includes("recaptcha") || message.includes("CORS")) {
            window._recaptchaErrors.push(message);
            if (message.includes("CORS")) {
              window._corsErrors.push(message);
            }
          }
          return originalConsoleError.apply(this, args);
        };

        // Add missing DOM methods that reCAPTCHA might expect
        if (!document.elementsFromPoint) {
          document.elementsFromPoint = function (x, y) {
            const element = document.elementFromPoint(x, y);
            return element ? [element] : [];
          };
        }

        // Mock additional reCAPTCHA-related globals
        window.___grecaptcha_cfg = window.___grecaptcha_cfg || {
          clients: {},
          count: 0,
        };

        // Prevent reCAPTCHA from detecting automation
        Object.defineProperty(window, "outerHeight", {
          get: () => window.innerHeight,
        });
        Object.defineProperty(window, "outerWidth", {
          get: () => window.innerWidth,
        });
      });

      // Inject dark mode CSS for websites that don't support it natively
      await this.page.evaluateOnNewDocument(() => {
        // Set dark mode preference for sites that respect it
        Object.defineProperty(window, "matchMedia", {
          value: function (query) {
            if (query === "(prefers-color-scheme: dark)") {
              return {
                matches: true,
                addListener: () => {},
                removeListener: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
              };
            }
            // Return original matchMedia for other queries
            return (
              window.matchMedia?.call?.(window, query) || { matches: false }
            );
          },
        });

        // Inject subtle dark mode CSS for sites that don't support it natively
        const darkModeCSS = `
          /* Set color scheme preference */
          :root {
            color-scheme: dark;
          }
          
          /* Only apply dark background to body if no existing dark mode */
          body:not([data-dark-mode]):not([class*="dark"]):not([class*="night"]):not([style*="background-color: rgb(0"]):not([style*="background-color: #0"]):not([style*="background-color: #1"]):not([style*="background-color: #2"]):not([style*="background-color: #3"]) {
            background-color: #1a1a1a !important;
            color: #e0e0e0 !important;
          }
          
          /* Preserve all interactive elements and media */
          iframe, img, video, canvas, svg, embed, object,
          iframe[src*="recaptcha"], 
          iframe[src*="google.com/recaptcha"],
          div[class*="recaptcha"],
          .g-recaptcha,
          [role="button"],
          button, input, select, textarea {
            filter: none !important;
            background: initial !important;
          }
        `;

        // Wait for DOM and inject CSS
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", () => {
            const style = document.createElement("style");
            style.innerHTML = darkModeCSS;
            document.head?.appendChild(style);
          });
        } else {
          const style = document.createElement("style");
          style.innerHTML = darkModeCSS;
          document.head?.appendChild(style);
        }
      });

      logger?.info("Browser initialized successfully", {
        userAgent: this.fingerprint.userAgent.substring(0, 50) + "...",
        viewport: this.currentViewport,
        darkMode: true,
      });

      console.log(
        chalk.green("✅ Browser initialized with stealth mode + dark theme")
      );
    } catch (error) {
      logger?.error("Failed to initialize browser", {
        error: error.message,
        stack: error.stack,
      });
      console.error(
        chalk.red("❌ Browser initialization failed:"),
        error.message
      );
      throw error;
    }
  }

  async applyFingerprint() {
    try {
      // Apply advanced anti-detection measures before page load
      await this.page.setBypassCSP(true);

      // Set permissions
      const context = this.browser.defaultBrowserContext();
      await context.overridePermissions("https://www.google.com", [
        "geolocation",
        "notifications",
      ]);

      // Override navigator properties to match fingerprint
      await this.page.evaluateOnNewDocument((fingerprint) => {
        // Override timezone
        Object.defineProperty(
          Intl.DateTimeFormat.prototype,
          "resolvedOptions",
          {
            value: function () {
              return Object.assign(
                Intl.DateTimeFormat.prototype.resolvedOptions.call(this),
                { timeZone: fingerprint.timezone }
              );
            },
          }
        );

        // Override languages
        Object.defineProperty(navigator, "languages", {
          get: () => fingerprint.languages,
        });
        Object.defineProperty(navigator, "language", {
          get: () => fingerprint.languages[0],
        });

        // Override platform
        Object.defineProperty(navigator, "platform", {
          get: () => fingerprint.platform,
        });

        // Override hardware concurrency
        Object.defineProperty(navigator, "hardwareConcurrency", {
          get: () => fingerprint.hardwareConcurrency,
        });

        // Override device memory
        if (fingerprint.deviceMemory) {
          Object.defineProperty(navigator, "deviceMemory", {
            get: () => fingerprint.deviceMemory,
          });
        }

        // Override WebGL vendor and renderer
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (parameter) {
          if (parameter === 37445) {
            return fingerprint.webgl.vendor;
          }
          if (parameter === 37446) {
            return fingerprint.webgl.renderer;
          }
          return getParameter.call(this, parameter);
        };

        const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function (parameter) {
          if (parameter === 37445) {
            return fingerprint.webgl.vendor;
          }
          if (parameter === 37446) {
            return fingerprint.webgl.renderer;
          }
          return getParameter2.call(this, parameter);
        };

        // Override screen properties
        Object.defineProperty(screen, "width", {
          get: () => fingerprint.screen.width,
        });
        Object.defineProperty(screen, "height", {
          get: () => fingerprint.screen.height,
        });
        Object.defineProperty(screen, "availWidth", {
          get: () => fingerprint.screen.width,
        });
        Object.defineProperty(screen, "availHeight", {
          get: () => fingerprint.screen.height - 40, // Account for taskbar
        });
        Object.defineProperty(screen, "colorDepth", {
          get: () => fingerprint.colorDepth,
        });
        Object.defineProperty(screen, "pixelDepth", {
          get: () => fingerprint.pixelDepth,
        });

        // Override canvas fingerprinting
        const originalGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (
          contextType,
          contextAttributes
        ) {
          const context = originalGetContext.call(
            this,
            contextType,
            contextAttributes
          );

          if (contextType === "2d" && context) {
            const originalFillText = context.fillText;
            context.fillText = function (text, x, y, maxWidth) {
              // Add slight noise to make canvas fingerprint unique
              const noisyX = x + fingerprint.canvas.noise;
              const noisyY = y + fingerprint.canvas.noise;
              context.textBaseline = fingerprint.canvas.textBaseline;
              return originalFillText.call(
                this,
                text,
                noisyX,
                noisyY,
                maxWidth
              );
            };
          }

          return context;
        };

        // Override AudioContext fingerprinting
        if (window.AudioContext) {
          const OriginalAudioContext = window.AudioContext;
          window.AudioContext = function () {
            const context = new OriginalAudioContext();
            Object.defineProperty(context, "sampleRate", {
              get: () => fingerprint.audio.sampleRate,
            });
            return context;
          };
        }

        // Override navigator.plugins
        Object.defineProperty(navigator, "plugins", {
          get: () => {
            const pluginArray = Array.from(
              { length: fingerprint.plugins.length },
              (_, i) => ({
                name: fingerprint.plugins[i],
                filename:
                  fingerprint.plugins[i].toLowerCase().replace(/\s+/g, "") +
                  ".plugin",
                description: fingerprint.plugins[i],
                length: 1,
                [0]: {
                  type:
                    "application/x-" +
                    fingerprint.plugins[i].toLowerCase().replace(/\s+/g, ""),
                },
              })
            );

            // Make it look like a real PluginArray
            pluginArray.namedItem = (name) =>
              pluginArray.find((p) => p.name === name) || null;
            pluginArray.refresh = () => {};

            return pluginArray;
          },
        });

        // Override touch support
        if (fingerprint.touchSupport) {
          Object.defineProperty(navigator, "maxTouchPoints", {
            get: () => Math.floor(Math.random() * 5) + 1,
          });

          window.ontouchstart = null;
        } else {
          Object.defineProperty(navigator, "maxTouchPoints", {
            get: () => 0,
          });
        }

        // Override navigator.connection if supported
        if (
          navigator.connection ||
          navigator.mozConnection ||
          navigator.webkitConnection
        ) {
          const connection =
            navigator.connection ||
            navigator.mozConnection ||
            navigator.webkitConnection;
          Object.defineProperty(connection, "effectiveType", {
            get: () => fingerprint.connection,
          });
        }

        // Override battery API if supported
        if (fingerprint.battery && navigator.getBattery) {
          const _originalGetBattery = navigator.getBattery;
          navigator.getBattery = function () {
            return Promise.resolve({
              charging: fingerprint.battery.charging,
              level: fingerprint.battery.level,
              chargingTime: fingerprint.battery.charging
                ? Math.random() * 3600
                : Infinity,
              dischargingTime: !fingerprint.battery.charging
                ? Math.random() * 7200
                : Infinity,
              addEventListener: () => {},
              removeEventListener: () => {},
            });
          };
        }

        // Add realistic performance timing variations
        if (window.performance && window.performance.timing) {
          const originalNow = performance.now;
          performance.now = function () {
            // Add slight random variation to timing
            return originalNow.call(this) + (Math.random() - 0.5) * 0.1;
          };
        }

        // Override permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) =>
          parameters.name === "notifications"
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters);

        // Remove automation indicators
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        });

        // Delete navigator.webdriver property completely
        delete navigator.__proto__.webdriver;

        // Chrome specific with more complete implementation
        window.chrome = {
          runtime: {
            connect: () => {},
            sendMessage: () => {},
            onMessage: { addListener: () => {} },
          },
          loadTimes: function () {
            return {
              requestTime: Date.now() / 1000,
              startLoadTime: Date.now() / 1000,
              commitLoadTime: Date.now() / 1000,
              finishDocumentLoadTime: Date.now() / 1000,
              finishLoadTime: Date.now() / 1000,
              firstPaintTime: Date.now() / 1000,
              firstPaintAfterLoadTime: 0,
              navigationType: "Other",
              wasFetchedViaSpdy: false,
              wasNpnNegotiated: false,
              npnNegotiatedProtocol: "",
              wasAlternateProtocolAvailable: false,
              connectionInfo: "h2",
            };
          },
          csi: function () {
            return {
              onloadT: Date.now(),
              pageT: Date.now() - performance.timeOrigin,
              startE: performance.timeOrigin,
              tran: 15,
            };
          },
          app: {
            isInstalled: false,
            InstallState: {
              DISABLED: "disabled",
              INSTALLED: "installed",
              NOT_INSTALLED: "not_installed",
            },
            RunningState: {
              CANNOT_RUN: "cannot_run",
              READY_TO_RUN: "ready_to_run",
              RUNNING: "running",
            },
          },
        };

        // Remove puppeteer tracks
        delete window.__puppeteer_evaluation_script__;
        const properties = [
          "webdriver",
          "__driver_evaluate",
          "__webdriver_evaluate",
          "__selenium_evaluate",
          "__fxdriver_evaluate",
          "__driver_unwrapped",
          "__webdriver_unwrapped",
          "__selenium_unwrapped",
          "__fxdriver_unwrapped",
          "__webdriver_script_function",
          "__webdriver_script_func",
          "__webdriver_script_fn",
          "__fxdriver_script_fn",
          "__selenium_script_fn",
          "__webdriver_unwrapped",
          "__driver_evaluate",
          "__selenium_evaluate",
          "__fxdriver_evaluate",
          "__driver_unwrapped",
          "__webdriver_unwrapped",
          "__selenium_unwrapped",
          "__fxdriver_unwrapped",
          "_Selenium_IDE_Recorder",
          "_selenium",
          "calledSelenium",
          "$cdc_asdjflasutopfhvcZLmcfl_",
          "$chrome_asyncScriptInfo",
          "__$webdriverAsyncExecutor",
          "__lastWatirAlert",
          "__lastWatirConfirm",
          "__lastWatirPrompt",
          "__webdriver_script_fn",
          "__nightmare",
          "__selenium_evaluate",
          "__fxdriver_evaluate",
          "__driver_unwrapped",
        ];

        for (const prop of properties) {
          delete window[prop];
          delete document[prop];
        }

        // Add realistic window properties
        window.screenX = Math.floor(Math.random() * 200);
        window.screenY = Math.floor(Math.random() * 100);
        window.outerWidth = fingerprint.screen.width;
        window.outerHeight = fingerprint.screen.height;

        // Override Notification API
        const originalNotification = window.Notification;
        window.Notification = function (title, options) {
          return {
            title: title,
            options: options,
            close: () => {},
            addEventListener: () => {},
          };
        };
        window.Notification.permission = "default";
        window.Notification.requestPermission = () =>
          Promise.resolve("default");

        // Override plugins to look more realistic
        Object.defineProperty(navigator, "plugins", {
          get: () => {
            const plugins = [
              {
                name: "Chrome PDF Plugin",
                description: "Portable Document Format",
                filename: "internal-pdf-viewer",
                length: 1,
                item: (i) => ({
                  type: "application/x-google-chrome-pdf",
                  suffixes: "pdf",
                  description: "Portable Document Format",
                  enabledPlugin: true,
                }),
                namedItem: () => null,
              },
              {
                name: "Chrome PDF Viewer",
                description: "Portable Document Format",
                filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
                length: 1,
                item: (i) => ({
                  type: "application/pdf",
                  suffixes: "pdf",
                  description: "Portable Document Format",
                  enabledPlugin: true,
                }),
                namedItem: () => null,
              },
              {
                name: "Native Client",
                description: "",
                filename: "internal-nacl-plugin",
                length: 2,
                item: (i) =>
                  i === 0
                    ? {
                        type: "application/x-nacl",
                        suffixes: "",
                        description: "Native Client Executable",
                        enabledPlugin: true,
                      }
                    : {
                        type: "application/x-pnacl",
                        suffixes: "",
                        description: "Portable Native Client Executable",
                        enabledPlugin: true,
                      },
                namedItem: () => null,
              },
            ];

            plugins.length = plugins.length;
            return plugins;
          },
        });

        // Override mimeTypes
        Object.defineProperty(navigator, "mimeTypes", {
          get: () => {
            const mimeTypes = [
              {
                type: "application/pdf",
                suffixes: "pdf",
                description: "Portable Document Format",
                enabledPlugin: navigator.plugins[0],
              },
              {
                type: "application/x-google-chrome-pdf",
                suffixes: "pdf",
                description: "Portable Document Format",
                enabledPlugin: navigator.plugins[1],
              },
              {
                type: "application/x-nacl",
                suffixes: "",
                description: "Native Client Executable",
                enabledPlugin: navigator.plugins[2],
              },
              {
                type: "application/x-pnacl",
                suffixes: "",
                description: "Portable Native Client Executable",
                enabledPlugin: navigator.plugins[2],
              },
            ];

            mimeTypes.length = mimeTypes.length;
            return mimeTypes;
          },
        });

        // Fix toString methods to appear native
        const nativeToStringFunctionString = Error.toString().replace(
          /Error/g,
          "toString"
        );
        const nativeToStringName = "toString";

        Object.defineProperty(Function.prototype.toString, "name", {
          value: nativeToStringName,
          configurable: true,
        });

        const oldToString = Function.prototype.toString;
        Function.prototype.toString = new Proxy(oldToString, {
          apply(target, thisArg, args) {
            if (thisArg === window.navigator.permissions.query) {
              return "function query() { [native code] }";
            }
            if (thisArg && thisArg.name === "getParameter") {
              return "function getParameter() { [native code] }";
            }
            return target.apply(thisArg, args);
          },
        });

        // Override console.debug to prevent detection
        const originalConsoleDebug = console.debug;
        console.debug = function (...args) {
          if (
            args[0] &&
            typeof args[0] === "string" &&
            args[0].includes("HeadlessChrome")
          ) {
            return;
          }
          return originalConsoleDebug.apply(console, args);
        };

        // Battery API (random battery level)
        if ("getBattery" in navigator) {
          const battery = {
            charging: Math.random() > 0.5,
            chargingTime:
              Math.random() > 0.5
                ? Infinity
                : Math.floor(Math.random() * 10000),
            dischargingTime: Math.floor(Math.random() * 20000) + 3600,
            level: Math.random() * 0.5 + 0.5, // 50-100%
          };

          navigator.getBattery = async () => battery;
        }

        // Mock media devices
        if (!navigator.mediaDevices) {
          navigator.mediaDevices = {};
        }

        navigator.mediaDevices.enumerateDevices = async () => {
          return [
            {
              deviceId: "default",
              kind: "audioinput",
              label: "Default Audio Device",
              groupId: "default",
            },
            {
              deviceId: "communications",
              kind: "audioinput",
              label: "Communications Device",
              groupId: "communications",
            },
            {
              deviceId: "default",
              kind: "audiooutput",
              label: "Default Audio Device",
              groupId: "default",
            },
            {
              deviceId: Math.random().toString(36),
              kind: "videoinput",
              label: "Integrated Camera",
              groupId: Math.random().toString(36),
            },
          ];
        };
      }, this.fingerprint);

      // Set extra HTTP headers
      await this.page.setExtraHTTPHeaders({
        "Accept-Language": this.fingerprint.languages.join(","),
        "Accept-Encoding": "gzip, deflate, br",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Sec-Ch-Ua": `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`,
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": `"${
          this.fingerprint.platform === "MacIntel"
            ? "macOS"
            : this.fingerprint.platform === "Win32"
            ? "Windows"
            : "Linux"
        }"`,
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      });

      logger?.info("Fingerprint applied successfully", {
        platform: this.fingerprint.platform,
        languages: this.fingerprint.languages,
        timezone: this.fingerprint.timezone,
      });
    } catch (error) {
      logger?.error("Error applying fingerprint", { error: error.message });
    }
  }

  async handleAutomatedQueriesWithProxySwitch(
    currentDork = null,
    retryCount = 0
  ) {
    if (!this.options.useProxyOnCaptcha) {
      logger?.info("Proxy not enabled for CAPTCHA, switching to manual mode");
      return false;
    }

    // Prevent infinite recursion with blocked proxies
    if (retryCount >= 3) {
      console.log(chalk.red("❌ Maximum proxy retry attempts reached (3)"));
      logger?.warn("Maximum proxy switch retries reached", { retryCount });
      return false;
    }

    if (retryCount > 0) {
      console.log(chalk.blue(`🔄 Proxy switch attempt ${retryCount + 1}/3`));
    }

    try {
      console.log(
        chalk.yellow(
          "🔄 Automated queries detected - attempting proxy switch..."
        )
      );
      logger?.info(
        "Attempting to switch proxy due to automated queries detection"
      );

      // Delete the old proxy before getting a new one
      if (this.currentProxy && this.currentProxy.id) {
        console.log(
          chalk.blue(`🗑️  Deleting previous proxy ${this.currentProxy.id}...`)
        );
        await deleteProxy(this.currentProxy.id);
        this.currentProxy = null; // Clear it out
      }

      // Test API connection first if this is the first time using proxy
      if (!this.proxyApiTested) {
        console.log(chalk.blue("🔍 Testing ASOCKS API connection..."));
        const apiWorks = await testAsocksAPI();
        this.proxyApiTested = true;

        if (!apiWorks) {
          logger?.warn("ASOCKS API test failed, proxy functionality disabled");
          console.log(
            chalk.red(
              "❌ ASOCKS API not working - proxy functionality disabled"
            )
          );
          return false;
        }
      }

      // Generate a new proxy
      const newProxy = await generateProxy();
      if (!newProxy || !newProxy.host) {
        console.log(chalk.red("❌ Failed to generate new proxy"));
        logger?.error(
          "Failed to generate new proxy for automated queries recovery"
        );
        return false;
      }

      console.log(
        chalk.blue(`🌐 Generated new proxy: ${newProxy.host}:${newProxy.port}`)
      );

      // Test the new proxy
      console.log(chalk.blue("🔍 Testing new proxy connection..."));
      const proxyWorks = await this.testProxyConnection(newProxy);

      if (!proxyWorks) {
        console.log(chalk.red("❌ New proxy connection failed"));
        logger?.error("New proxy connection test failed", { proxy: newProxy });
        // Delete the failed proxy
        if (newProxy.id) {
          await deleteProxy(newProxy.id);
        }
        return false;
      }

      console.log(chalk.green("✅ New proxy connection successful"));

      // Close current browser session
      console.log(chalk.blue("🔄 Restarting browser with new proxy..."));
      if (this.browser) {
        await this.browser.close();
      }

      // Set the new proxy as current
      this.currentProxy = newProxy;
      this.proxiesUsed.push(newProxy);

      // Reinitialize browser with new proxy
      await this.initialize();

      console.log(chalk.green("✅ Browser restarted with new proxy"));

      // Navigate to Google and perform search again if we have the dork
      if (currentDork) {
        console.log(
          chalk.blue("🔄 Navigating to Google and retrying search...")
        );

        try {
          // Navigate to Google with error handling for proxy blocks
          let navigationSuccessful = false;
          const googleUrls = [
            "https://www.google.com",
            "https://google.com",
            "https://www.google.com/ncr", // No country redirect
          ];

          for (const url of googleUrls) {
            try {
              console.log(chalk.blue(`🌐 Trying to access: ${url}`));

              const response = await this.page.goto(url, {
                waitUntil: "networkidle2",
                timeout: 30000,
              });

              // Check if we got a 403 or other error status
              if (response && response.status() >= 400) {
                console.log(
                  chalk.yellow(`⚠️ Got HTTP ${response.status()} from ${url}`)
                );

                if (response.status() === 403) {
                  console.log(chalk.red("🚫 Google is blocking this proxy IP"));

                  // Check if this is the last URL to try
                  if (url === googleUrls[googleUrls.length - 1]) {
                    console.log(
                      chalk.red(
                        "❌ All Google URLs blocked by proxy - proxy may be blacklisted"
                      )
                    );

                    // Clean up the blocked proxy
                    await deleteProxy(newProxy.id);
                    this.currentProxy = null;
                    this.proxiesUsed.pop();

                    logger?.warn("Proxy blocked by Google, trying new proxy", {
                      proxy: `${newProxy.host}:${newProxy.port}`,
                      status: response.status(),
                    });

                    console.log(chalk.blue("🔄 Trying to get a new proxy..."));

                    // Try to get a new proxy
                    const replacementProxy = await generateProxy();
                    if (replacementProxy) {
                      console.log(
                        chalk.green(
                          `🌐 Got replacement proxy: ${replacementProxy.host}:${replacementProxy.port}`
                        )
                      );

                      // Test the new proxy
                      const replacementWorks = await this.testProxyConnection(
                        replacementProxy
                      );
                      if (replacementWorks) {
                        // Set new proxy and restart browser
                        this.currentProxy = replacementProxy;
                        this.proxiesUsed.push(replacementProxy);

                        // Close and reinitialize browser with new proxy
                        await this.browser.close();
                        await this.initialize();

                        console.log(
                          chalk.green(
                            "✅ Browser restarted with replacement proxy"
                          )
                        );

                        // Recursive call to try navigation again with new proxy
                        return await this.handleAutomatedQueriesWithProxySwitch(
                          currentDork,
                          retryCount + 1
                        );
                      } else {
                        console.log(
                          chalk.red("❌ Replacement proxy also failed")
                        );
                        await deleteProxy(replacementProxy.id);
                      }
                    }

                    return false;
                  }
                  continue; // Try next URL
                }
              }

              // If we get here, navigation was successful
              navigationSuccessful = true;
              console.log(
                chalk.green(`✅ Successfully accessed Google via proxy`)
              );
              break;
            } catch (urlError) {
              console.log(
                chalk.yellow(`⚠️ Failed to access ${url}: ${urlError.message}`)
              );

              // If this was the last URL and we still have errors
              if (url === googleUrls[googleUrls.length - 1]) {
                throw urlError; // Re-throw to be caught by outer catch
              }
            }
          }

          if (!navigationSuccessful) {
            throw new Error("All Google URLs failed with proxy");
          }

          // Wait for page to fully load and settle
          await sleep(3000);

          // Check for any error messages on the page
          const hasErrorPage = await this.page.evaluate(() => {
            const pageText =
              document.body?.innerText || document.body?.textContent || "";
            const errorMessages = [
              "403",
              "Forbidden",
              "Access denied",
              "blocked",
              "Your client does not have permission",
              "The request could not be satisfied",
            ];

            return errorMessages.some((msg) =>
              pageText.toLowerCase().includes(msg.toLowerCase())
            );
          });

          if (hasErrorPage) {
            console.log(
              chalk.red("🚫 Error page detected - proxy may be blocked")
            );
            logger?.warn("Error page detected after navigation", {
              proxy: `${newProxy.host}:${newProxy.port}`,
            });

            // Clean up blocked proxy
            await deleteProxy(newProxy.id);
            this.currentProxy = null;
            this.proxiesUsed.pop();

            console.log(
              chalk.blue("🔄 Trying to get a new proxy due to error page...")
            );

            // Try to get a new proxy
            const replacementProxy = await generateProxy();
            if (replacementProxy) {
              console.log(
                chalk.green(
                  `🌐 Got replacement proxy: ${replacementProxy.host}:${replacementProxy.port}`
                )
              );

              // Test the new proxy
              const replacementWorks = await this.testProxyConnection(
                replacementProxy
              );
              if (replacementWorks) {
                // Set new proxy and restart browser
                this.currentProxy = replacementProxy;
                this.proxiesUsed.push(replacementProxy);

                // Close and reinitialize browser with new proxy
                await this.browser.close();
                await this.initialize();

                console.log(
                  chalk.green("✅ Browser restarted with replacement proxy")
                );

                // Recursive call to try navigation again with new proxy
                return await this.handleAutomatedQueriesWithProxySwitch(
                  currentDork,
                  retryCount + 1
                );
              } else {
                console.log(chalk.red("❌ Replacement proxy also failed"));
                await deleteProxy(replacementProxy.id);
              }
            }

            return false;
          }

          // Handle cookie consent with force flag to ensure it runs
          await this.handleCookieConsent(true);

          // Additional wait after cookie consent
          await sleep(2000);

          // Perform the search
          if (this.isGoogleEngine) {
            await this.simulateHumanGoogleSearch(currentDork);
          } else {
            const searchUrl = this.engine.searchUrl(currentDork);
            await this.page.goto(searchUrl, {
              waitUntil: "networkidle2",
              timeout: 30000,
            });
          }

          // Wait for search results to load
          await sleep(3000);

          // Check if we're still on a CAPTCHA page after the new search
          const stillOnCaptcha = await this.page.evaluate(() => {
            const currentUrl = window.location.href;
            const hasCaptchaElements =
              document.querySelector('iframe[src*="recaptcha"]') ||
              document.querySelector(".g-recaptcha") ||
              currentUrl.includes("/sorry");
            return hasCaptchaElements;
          });

          logger?.info("Search resumed with new proxy", { dork: currentDork });
          console.log(chalk.green("✅ Search resumed successfully with proxy"));

          if (stillOnCaptcha) {
            console.log(
              chalk.yellow(
                "🔄 New CAPTCHA detected after proxy switch - will restart fresh"
              )
            );
            logger?.info(
              "New CAPTCHA detected after proxy switch, will restart detection",
              { dork: currentDork }
            );
          } else {
            console.log(
              chalk.green(
                "✅ No CAPTCHA detected - search successful with proxy"
              )
            );
            logger?.info(
              "Search completed successfully without CAPTCHA after proxy switch",
              { dork: currentDork }
            );
          }

          // Always signal restart after successful proxy switch and navigation
          // This will cause the search to restart and detect CAPTCHA fresh if present
          console.log(
            chalk.blue(
              "🔄 Proxy switch successful - restarting search for fresh CAPTCHA detection"
            )
          );
          throw new Error("proxy_switched_success");
        } catch (navigationError) {
          // Don't treat proxy_switched_success as a navigation error
          if (navigationError.message === "proxy_switched_success") {
            throw navigationError; // Re-throw to be handled by the calling function
          }

          logger?.error("Failed to navigate with new proxy", {
            error: navigationError.message,
            proxy: `${newProxy.host}:${newProxy.port}`,
          });
          console.log(
            chalk.red(
              `❌ Navigation failed with proxy: ${navigationError.message}`
            )
          );

          // If navigation failed, clean up the proxy
          if (newProxy.id) {
            await deleteProxy(newProxy.id);
            this.currentProxy = null;
            this.proxiesUsed.pop();
          }

          return false;
        }
      }

      logger?.info("Successfully switched proxy and restarted browser", {
        newProxyHost: newProxy.host,
        newProxyPort: newProxy.port,
      });

      // A successful proxy switch is not an error, so return true.
      // The calling function will handle restarting the search.
      return true;
    } catch (error) {
      if (error.message.includes("proxy_switched")) {
        throw error;
      }

      logger?.error("Error during proxy switch for automated queries", {
        error: error.message,
        stack: error.stack,
      });
      console.log(chalk.red(`❌ Proxy switch failed: ${error.message}`));
      return false;
    }
  }

  async enableProxyForCaptcha(currentDork = null) {
    if (!this.options.useProxyOnCaptcha) return false;

    try {
      logger?.info("CAPTCHA detected, attempting to enable proxy");
      console.log(chalk.yellow("🌐 CAPTCHA detected! Generating new proxy..."));

      // Test API connection first if this is the first time using proxy
      if (!this.proxyApiTested) {
        console.log(chalk.blue("🔍 Testing ASOCKS API connection..."));
        const apiWorks = await testAsocksAPI();
        this.proxyApiTested = true;

        if (!apiWorks) {
          logger?.warn("ASOCKS API test failed, proxy functionality disabled");
          console.log(
            chalk.red(
              "❌ ASOCKS API not working - proxy functionality disabled"
            )
          );
          return false;
        }
      }

      // Delete previous proxy if exists
      if (this.currentProxy && this.currentProxy.id) {
        console.log(chalk.blue("🗑️ Cleaning up previous proxy..."));
        await deleteProxy(this.currentProxy.id);
      }

      const proxy = await generateProxy();
      if (!proxy) {
        logger?.warn("Failed to generate proxy for CAPTCHA");
        console.log(chalk.red("❌ Failed to generate proxy"));
        return false;
      }

      this.currentProxy = proxy;
      this.proxiesUsed.push(proxy); // Track for cleanup

      logger?.info("Proxy generated for CAPTCHA", {
        id: proxy.id,
        host: proxy.host,
        port: proxy.port,
      });
      console.log(
        chalk.green(
          `✅ Proxy generated: ${proxy.host}:${proxy.port} (ID: ${proxy.id}, User: ${proxy.username})`
        )
      );

      // Test proxy connection externally first (SOCKS5 test)
      console.log(chalk.blue("🔍 Testing proxy connection externally..."));
      const proxyWorks = await this.testProxyConnection(proxy);

      if (!proxyWorks) {
        console.log(chalk.red("❌ Proxy connection test failed"));
        logger?.warn("External proxy test failed", {
          proxy: `${proxy.host}:${proxy.port}`,
        });

        // Clean up the bad proxy
        await deleteProxy(proxy.id);
        this.currentProxy = null;
        this.proxiesUsed.pop(); // Remove from tracking

        // Try to get a new proxy automatically
        console.log(chalk.blue("🌐 Generating replacement proxy..."));
        const newProxy = await generateProxy();

        if (!newProxy) {
          logger?.warn("Failed to generate replacement proxy");
          console.log(chalk.red("❌ Failed to generate replacement proxy"));
          return false;
        }

        // Update proxy references
        this.currentProxy = newProxy;
        this.proxiesUsed.pop(); // Remove the old failed one
        this.proxiesUsed.push(newProxy);

        console.log(
          chalk.green(
            `✅ New proxy generated: ${newProxy.host}:${newProxy.port} (ID: ${newProxy.id} ${newProxy.username} ${newProxy.password})`
          )
        );

        // Test the new proxy with retries
        const newProxyWorks = await this.testProxyConnection(newProxy);
        if (!newProxyWorks) {
          console.log(chalk.red("❌ Replacement proxy also failed"));
          await deleteProxy(newProxy.id);
          this.currentProxy = null;
          this.proxiesUsed.pop();
          return false;
        }

        console.log(chalk.green("✅ Replacement proxy test passed"));
      } else {
        console.log(chalk.green("✅ Proxy connection test passed"));
      }

      // Only restart browser if proxy test passed
      console.log(chalk.blue("🔄 Restarting browser with working proxy..."));
      await this.close();
      await this.initialize();

      // Quick verification that browser can access Google with proxy
      console.log(chalk.blue("🔍 Verifying browser proxy connection..."));
      let connectionWorking = false;

      // Give proxy time to stabilize after browser restart
      console.log(
        chalk.yellow("⏳ Waiting 3 seconds for proxy to stabilize...")
      );
      await sleep(3000);

      try {
        // Test with Google directly since that's what we'll be using
        await this.page.goto("https://www.google.com", {
          waitUntil: "domcontentloaded",
          timeout: 20000, // 20 second timeout for slow proxies
        });

        // Small delay to let page settle
        await sleep(2000);

        // Check for specific proxy error messages
        const hasProxyError = await this.page.evaluate(() => {
          const pageText =
            document.body?.innerText || document.body?.textContent || "";
          const errorMessages = [
            "No Internet",
            "ERR_PROXY_CONNECTION_FAILED",
            "There is something wrong with the proxy server",
            "proxy server or the address is incorrect",
            "Contacting the system admin",
            "Checking the proxy address",
            "This site can't be reached",
            "took too long to respond",
            "Check your Internet connection",
            "ERR_INTERNET_DISCONNECTED",
            "ERR_NETWORK_CHANGED",
          ];

          return errorMessages.some((msg) =>
            pageText.toLowerCase().includes(msg.toLowerCase())
          );
        });

        if (hasProxyError) {
          logger?.warn("Proxy error detected on page", {
            proxy: `${proxy.host}:${proxy.port}`,
          });
          console.log(chalk.red("❌ Proxy error detected on page"));
          connectionWorking = false;
        } else {
          console.log(chalk.green("✅ Proxy connection verified with Google"));
          logger?.info("Proxy connection test successful with Google");
          connectionWorking = true;
        }
      } catch (testError) {
        logger?.warn("Proxy connection test failed", {
          error: testError.message,
          proxy: `${proxy.host}:${proxy.port}`,
        });
        console.log(
          chalk.red(`❌ Proxy connection failed: ${testError.message}`)
        );
        connectionWorking = false;
      }

      if (!connectionWorking) {
        console.log(
          chalk.yellow("🔄 Proxy failed, will try to get a new one...")
        );

        // Clean up the bad proxy
        await deleteProxy(proxy.id);
        this.currentProxy = null;
        this.proxiesUsed.pop(); // Remove from tracking

        // Try to get a new proxy automatically
        console.log(chalk.blue("🌐 Generating replacement proxy..."));
        const newProxy = await generateProxy();

        if (!newProxy) {
          logger?.warn("Failed to generate replacement proxy");
          console.log(chalk.red("❌ Failed to generate replacement proxy"));
          return false;
        }

        this.currentProxy = newProxy;
        this.proxiesUsed.push(newProxy);

        console.log(
          chalk.green(
            `✅ New proxy: ${newProxy.host}:${newProxy.port} (ID: ${newProxy.id})`
          )
        );

        // Reinitialize browser with new proxy
        await this.close();
        await this.initialize();

        // Test the new proxy
        try {
          await this.page.goto("https://www.google.com", {
            waitUntil: "domcontentloaded",
            timeout: 15000,
          });

          await sleep(2000);

          const hasNewProxyError = await this.page.evaluate(() => {
            const pageText =
              document.body?.innerText || document.body?.textContent || "";
            const errorMessages = [
              "No Internet",
              "ERR_PROXY_CONNECTION_FAILED",
              "There is something wrong with the proxy server",
            ];

            return errorMessages.some((msg) =>
              pageText.toLowerCase().includes(msg.toLowerCase())
            );
          });

          if (hasNewProxyError) {
            console.log(chalk.red("❌ Replacement proxy also failed"));
            await deleteProxy(newProxy.id);
            this.currentProxy = null;
            this.proxiesUsed.pop();
            return false;
          } else {
            console.log(chalk.green("✅ Replacement proxy working"));
          }
        } catch (newTestError) {
          console.log(chalk.red("❌ Replacement proxy test failed"));
          await deleteProxy(newProxy.id);
          this.currentProxy = null;
          this.proxiesUsed.pop();
          return false;
        }
      }

      // If we have the current dork, navigate to Google and perform the search
      if (currentDork) {
        console.log(chalk.blue("🔄 Resuming search with new proxy..."));

        try {
          // Navigate to Google and handle cookie consent
          await this.page.goto("https://www.google.com", {
            waitUntil: "domcontentloaded",
            timeout: 25000,
          });

          // Small delay to let page settle
          await sleep(2000);

          // Handle cookie consent
          await this.handleCookieConsent();

          // Perform the search with the new proxy
          if (this.isGoogleEngine) {
            await this.simulateHumanGoogleSearch(currentDork);
          } else {
            const searchUrl = this.engine.searchUrl(currentDork);
            await this.page.goto(searchUrl, {
              waitUntil: "domcontentloaded",
              timeout: 30000,
            });
          }

          // Wait up to 15 seconds for results to load, then refresh if needed
          console.log(
            chalk.blue("⏳ Waiting for results to load (15s max)...")
          );
          await sleep(15000); // Wait 15 seconds as requested

          // Check if we have an error page or need to refresh
          const needsRefresh = await this.page.evaluate(() => {
            const pageText =
              document.body?.innerText || document.body?.textContent || "";
            const currentUrl = window.location.href;

            // Check for error messages
            const hasError = [
              "No Internet",
              "ERR_PROXY_CONNECTION_FAILED",
              "There is something wrong with the proxy server",
              "This site can't be reached",
              "took too long to respond",
            ].some((msg) => pageText.toLowerCase().includes(msg.toLowerCase()));

            // Check if we're still on a loading page or homepage
            const isLoadingOrHomepage =
              currentUrl.includes("google.com") &&
              (!currentUrl.includes("/search") ||
                pageText.includes("Google Search"));

            return hasError || isLoadingOrHomepage;
          });

          if (needsRefresh) {
            console.log(
              chalk.yellow("🔄 Page needs refresh, refreshing now...")
            );
            await this.page.reload({
              waitUntil: "domcontentloaded",
              timeout: 15000,
            });
            await sleep(3000);

            // Check again for errors after refresh
            const stillHasError = await this.page.evaluate(() => {
              const pageText =
                document.body?.innerText || document.body?.textContent || "";
              return [
                "No Internet",
                "ERR_PROXY_CONNECTION_FAILED",
                "There is something wrong with the proxy server",
              ].some((msg) =>
                pageText.toLowerCase().includes(msg.toLowerCase())
              );
            });

            if (stillHasError) {
              console.log(
                chalk.red("❌ Still getting proxy errors after refresh")
              );
              return false; // Will trigger proxy change in tryAutomaticCaptchaSolving
            }
          }

          logger?.info("Search resumed with new proxy", { dork: currentDork });
          console.log(chalk.green("✅ Search resumed successfully with proxy"));
        } catch (navigationError) {
          logger?.error("Failed to navigate with new proxy", {
            error: navigationError.message,
            proxy: `${this.currentProxy?.host}:${this.currentProxy?.port}`,
          });
          console.log(
            chalk.red(
              `❌ Navigation failed with proxy: ${navigationError.message}`
            )
          );

          // Don't clean up proxy here - it might work for other attempts
          return false;
        }
      }

      return true;
    } catch (error) {
      logger?.warn("Failed to enable proxy for CAPTCHA", {
        error: error.message,
      });
      console.log(chalk.red(`❌ Failed to enable proxy: ${error.message}`));
      return false;
    }
  }

  async downloadAudioFile(audioUrl) {
    try {
      // Check cache first to prevent duplicate downloads
      if (this.audioCache.has(audioUrl)) {
        const cachedPath = this.audioCache.get(audioUrl);
        console.log(
          chalk.green(
            `✅ Using cached audio file: ${path.basename(cachedPath)}`
          )
        );
        return cachedPath;
      }

      console.log(
        chalk.gray(`📥 Downloading audio from: ${audioUrl.substring(0, 80)}...`)
      );

      const tempDir = path.join(process.cwd(), "temp");
      await fs.mkdir(tempDir, { recursive: true });

      const tempFileName = `captcha_audio_${Date.now()}.mp3`;
      const tempFilePath = path.join(tempDir, tempFileName);

      const response = await axios({
        method: "GET",
        url: audioUrl,
        responseType: "stream",
        timeout: 30000,
        headers: {
          "User-Agent": await this.page.evaluate(() => navigator.userAgent),
          Referer: "https://www.google.com/",
          Accept: "audio/mpeg,audio/*,*/*",
        },
      });

      const writer = createWriteStream(tempFilePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on("finish", () => {
          console.log(chalk.green(`✅ Audio downloaded to: ${tempFilePath}`));
          // Cache the download result
          this.audioCache.set(audioUrl, tempFilePath);
          resolve(tempFilePath);
        });
        writer.on("error", (error) => {
          console.log(
            chalk.red(`❌ Error writing audio file: ${error.message}`)
          );
          reject(error);
        });
      });
    } catch (error) {
      console.log(chalk.red(`❌ Error downloading audio: ${error.message}`));
      throw error;
    }
  }

  async solveAudioCaptcha(audioUrl) {
    try {
      let tempAudioPath;
      if (audioUrl.startsWith("http")) {
        tempAudioPath = await this.downloadAudioFile(audioUrl);
      } else {
        tempAudioPath = audioUrl;
      }

      if (!tempAudioPath) {
        throw new Error("Failed to get local audio path.");
      }

      const stats = await fs.stat(tempAudioPath);
      const fileSizeInKb = (stats.size / 1024).toFixed(2);

      const duration = getMP3Duration(await fs.readFile(tempAudioPath));
      const durationInSeconds = (duration / 1000).toFixed(2);

      console.log(
        chalk.gray(
          `🎵 Audio file info: ${durationInSeconds}s, ${fileSizeInKb} KB`
        )
      );

      const transcription = await this.solveWithElevenLabsTranscription(
        tempAudioPath
      );

      if (transcription) {
        console.log(chalk.green(`🎤 Transcription: "${transcription}"`));
        return transcription;
      }

      logger?.warn("Google Speech-to-Text failed, trying Web Speech API...");
      return await this.solveWithWebSpeechAPI(audioUrl);
    } catch (error) {
      logger?.error("Audio CAPTCHA solving failed", { error: error.message });
      console.log(chalk.red(`❌ Error in solveAudioCaptcha: ${error.message}`));
      return null;
    }
  }

  async solveWithElevenLabsTranscription(filePath) {
    try {
      if (!process.env.ELEVENLABS_API_KEY) {
        console.log(
          chalk.yellow(
            "⚠️ ELEVENLABS_API_KEY not set, skipping ElevenLabs transcription API."
          )
        );
        return null;
      }

      console.log(
        chalk.blue("🎯 Using ElevenLabs transcription for audio CAPTCHA...")
      );

      // Import form-data for creating multipart/form-data request
      const FormData = (await import("form-data")).default;

      // Create form data
      const formData = new FormData();
      formData.append("model_id", "scribe_v1");
      formData.append("file", fs.createReadStream(filePath));
      formData.append("language_code", "en");
      formData.append("tag_audio_events", "false"); // Don't need audio events for CAPTCHA
      formData.append("num_speakers", "1"); // CAPTCHAs typically have one speaker

      const response = await axios.post(
        "https://api.elevenlabs.io/v1/speech-to-text",
        formData,
        {
          headers: {
            "xi-api-key": process.env.ELEVENLABS_API_KEY,
            ...formData.getHeaders(),
          },
          timeout: 30000, // 30 second timeout
        }
      );

      if (response.data && response.data.text) {
        // Clean up transcription (remove extra spaces, normalize)
        let cleanedTranscription = response.data.text
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ") // normalize multiple spaces
          .replace(/[^\w\s]/g, ""); // remove punctuation

        console.log(
          chalk.green(`✅ ElevenLabs transcription: "${cleanedTranscription}"`)
        );
        if (response.data.language_probability) {
          console.log(
            chalk.gray(
              `🎯 Language confidence: ${(
                response.data.language_probability * 100
              ).toFixed(1)}%`
            )
          );
        }
        return cleanedTranscription;
      }

      console.log(
        chalk.yellow("⚠️ No transcription results from ElevenLabs API")
      );
      return null;
    } catch (error) {
      logger?.error("ElevenLabs transcription API error", {
        error: error.message,
      });
      if (error.response?.data) {
        console.log(
          chalk.red(
            `❌ ElevenLabs API Error: ${JSON.stringify(error.response.data)}`
          )
        );
      } else {
        console.log(
          chalk.red(`❌ ElevenLabs Transcription Error: ${error.message}`)
        );
      }
      return null;
    }
  }

  async solveWithWebSpeechAPI(audioUrl) {
    try {
      const transcription = await this.page.evaluate(async (url) => {
        return new Promise((resolve) => {
          if (!("webkitSpeechRecognition" in window)) {
            resolve(null);
            return;
          }
          const SpeechRecognition = window.webkitSpeechRecognition;
          const recognition = new SpeechRecognition();
          recognition.continuous = false;
          recognition.interimResults = false;
          recognition.lang = "en-US";
          const audio = new Audio(url);
          audio.crossOrigin = "anonymous";
          recognition.onresult = (event) =>
            resolve(event.results[0][0].transcript);
          recognition.onerror = () => resolve(null);
          audio.oncanplaythrough = () => {
            recognition.start();
            audio.play();
          };
          setTimeout(() => {
            recognition.stop();
            resolve(null);
          }, 8000);
        });
      }, audioUrl);
      return transcription;
    } catch (error) {
      logger?.error("Web Speech API error", { error: error.message });
      return null;
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }

    // Clean up cached audio files
    if (this.audioCache && this.audioCache.size > 0) {
      console.log(
        chalk.blue(
          `🧹 Cleaning up ${this.audioCache.size} cached audio file(s)...`
        )
      );
      for (const filePath of this.audioCache.values()) {
        try {
          await fs.unlink(filePath);
        } catch (error) {
          // File might already be deleted, ignore error
        }
      }
      this.audioCache.clear();
    }

    // Clean up all used proxies
    if (this.proxiesUsed.length > 0) {
      console.log(
        chalk.blue(`🗑️ Cleaning up ${this.proxiesUsed.length} proxy(ies)...`)
      );
      for (const proxy of this.proxiesUsed) {
        if (proxy.id) {
          await deleteProxy(proxy.id);
        }
      }
      this.proxiesUsed = [];
    }

    // Clean up the browser profile directory
    if (this.userDataDir) {
      try {
        await fs.rm(this.userDataDir, { recursive: true, force: true });
        logger?.debug("Cleaned up browser profile directory", {
          dir: this.userDataDir,
        });
      } catch (error) {
        logger?.warn("Failed to cleanup browser profile", {
          dir: this.userDataDir,
          error: error.message,
        });
      }
    }
  }

  async simulateHumanBehavior() {
    try {
      logger?.debug("Starting human behavior simulation");

      // Check if page is still available
      if (!this.page || this.page.isClosed()) {
        logger?.warn("Page is closed, skipping human behavior simulation");
        return;
      }

      // Random initial delay (like a human reading/thinking)
      const thinkingTime = Math.random() * 2500 + 1500;
      await sleep(thinkingTime);

      // Check again before proceeding with mouse/keyboard actions
      if (this.page.isClosed()) {
        logger?.warn("Page closed during simulation, stopping");
        return;
      }

      try {
        const viewport = await this.page.viewport();

        // Get current mouse position (start from random edge)
        let currentX = Math.random() > 0.5 ? 0 : viewport.width;
        let currentY = Math.random() * viewport.height;

        // Simulate natural mouse entry into page
        await this.page.mouse.move(currentX, currentY);
        await this.page.mouse.move(viewport.width / 2, viewport.height / 2, {
          steps: 20,
        });

        // Simulate reading pattern with mouse (F-pattern or Z-pattern)
        const readingPattern = Math.random() > 0.5 ? "F" : "Z";

        if (readingPattern === "F") {
          // F-pattern reading (common for web pages)
          await this.page.mouse.move(
            viewport.width / 2,
            viewport.height * 0.2,
            { steps: 15 }
          );
          await this.page.mouse.move(
            viewport.width * 0.8,
            viewport.height * 0.2,
            { steps: 15 }
          );
          await sleep(Math.random() * 800 + 400);
          await this.page.mouse.move(
            viewport.width * 0.3,
            viewport.height * 0.4,
            { steps: 15 }
          );
          await sleep(Math.random() * 600 + 300);
          await this.page.mouse.move(
            viewport.width * 0.6,
            viewport.height * 0.4,
            { steps: 15 }
          );
        } else {
          // Z-pattern reading
          await this.page.mouse.move(
            viewport.width * 0.2,
            viewport.height * 0.2,
            { steps: 15 }
          );
          await this.page.mouse.move(
            viewport.width * 0.8,
            viewport.height * 0.2,
            { steps: 15 }
          );
          await sleep(Math.random() * 800 + 400);
          await this.page.mouse.move(
            viewport.width * 0.2,
            viewport.height * 0.8,
            { steps: 15 }
          );
          await sleep(Math.random() * 600 + 300);
          await this.page.mouse.move(
            viewport.width * 0.8,
            viewport.height * 0.8,
            { steps: 15 }
          );
        }

        // Simulate realistic scrolling behavior with momentum
        if (!this.page.isClosed()) {
          const scrollSessions = Math.floor(Math.random() * 2) + 1;

          for (let session = 0; session < scrollSessions; session++) {
            if (this.page.isClosed()) break;

            // Smooth scroll with deceleration
            const totalScroll = Math.random() * 600 + 200;
            const steps = 10;

            for (let i = 0; i < steps; i++) {
              if (this.page.isClosed()) break;

              // Deceleration curve
              const progress = i / steps;
              const easeOut = 1 - Math.pow(1 - progress, 3);
              const scrollAmount = (totalScroll / steps) * (1 - easeOut * 0.8);

              await this.page.evaluate((amount) => {
                window.scrollBy({
                  top: amount,
                  behavior: "smooth",
                });
              }, scrollAmount);

              await sleep(50 + Math.random() * 30);
            }

            // Pause after scroll session (reading time)
            await sleep(Math.random() * 1500 + 1000);
          }
        }

        // Simulate micro-movements (small mouse adjustments humans make)
        if (!this.page.isClosed()) {
          const microMovements = Math.floor(Math.random() * 3) + 2;
          const mousePos = await this.page.mouse._client
            .send("Input.getMousePosition")
            .catch(() => ({ x: viewport.width / 2, y: viewport.height / 2 }));

          for (let i = 0; i < microMovements; i++) {
            if (this.page.isClosed()) break;

            const microX = mousePos.x + (Math.random() - 0.5) * 20;
            const microY = mousePos.y + (Math.random() - 0.5) * 20;

            await this.page.mouse.move(microX, microY, { steps: 5 });
            await sleep(Math.random() * 400 + 200);
          }
        }

        // Simulate focus/blur events (tab switching behavior)
        if (!this.page.isClosed() && Math.random() > 0.7) {
          await this.page.evaluate(() => {
            window.dispatchEvent(new Event("blur"));
            setTimeout(
              () => window.dispatchEvent(new Event("focus")),
              Math.random() * 2000 + 1000
            );
          });
        }

        // Random keyboard interactions (more natural)
        if (!this.page.isClosed() && Math.random() > 0.6) {
          const keyActions = [
            async () => await this.page.keyboard.press("Tab"),
            async () => await this.page.keyboard.press("Escape"),
            async () => {
              await this.page.keyboard.down("Control");
              await sleep(50);
              await this.page.keyboard.press("KeyA");
              await this.page.keyboard.up("Control");
            },
          ];

          const action =
            keyActions[Math.floor(Math.random() * keyActions.length)];
          await action();
          await sleep(Math.random() * 300 + 100);
        }
      } catch (error) {
        logger?.debug("Human behavior action failed (non-critical)", {
          error: error.message,
        });
      }

      // Natural pause before continuing (variable reading speed)
      const readingPause = Math.random() * 1500 + 500;
      await sleep(readingPause);

      logger?.debug("Human behavior simulation completed");
    } catch (error) {
      logger?.warn("Human simulation error", { error: error.message });
    }
  }

  async waitForSearchResults() {
    try {
      logger?.debug("Waiting for search results to appear");

      // Shorter timeout for faster processing
      const TIMEOUT = 8000;

      // Wait for any of the result selectors to appear, with timeout
      const resultFound = await Promise.race([
        // Wait for results from any engine
        this.page
          .waitForSelector(this.engine.resultSelectors[0], { timeout: TIMEOUT })
          .then(() => true)
          .catch(() => false),
        this.page
          .waitForSelector(this.engine.resultSelectors[1] || "nonexistent", {
            timeout: TIMEOUT,
          })
          .then(() => true)
          .catch(() => false),
        this.page
          .waitForSelector(this.engine.resultSelectors[2] || "nonexistent", {
            timeout: TIMEOUT,
          })
          .then(() => true)
          .catch(() => false),
        // Timeout fallback
        sleep(TIMEOUT).then(() => false),
      ]);

      // Quick check for "no results" text
      const hasNoResultsText = await this.page
        .evaluate(() => {
          const pageText =
            document.body.textContent || document.body.innerText || "";
          const noResultsIndicators = [
            "No results",
            "didn't match",
            "Try different keywords",
            "did not match",
            "No search results",
            "nothing found",
            "Brak wyników",
            "nie znaleziono",
          ];
          return noResultsIndicators.some((indicator) =>
            pageText.toLowerCase().includes(indicator.toLowerCase())
          );
        })
        .catch(() => false);

      if (hasNoResultsText) {
        logger?.debug("No results text detected");
        return false;
      }

      if (resultFound) {
        // Double check that results actually contain links
        const hasValidResults = await this.page
          .evaluate((engine) => {
            for (const selector of engine.resultSelectors) {
              const results = document.querySelectorAll(selector);
              for (const result of results) {
                const linkEl = result.querySelector(engine.linkSelector);
                if (linkEl && linkEl.href && linkEl.href.startsWith("http")) {
                  return true;
                }
              }
            }
            return false;
          }, this.engine)
          .catch(() => false);

        logger?.debug("Search results validation", { hasValidResults });
        return hasValidResults;
      }

      logger?.debug("No results found within timeout");
      return false;
    } catch (error) {
      logger?.warn("Error waiting for search results", {
        error: error.message,
      });
      // If waiting fails, assume no results
      return false;
    }
  }

  async handleCookieConsent(force = false) {
    try {
      if (this.isGoogleEngine) {
        if (this.googleConsentHandled && !force) {
          logger?.debug(
            "Google consent already handled this session, skipping."
          );
          return;
        }
        if (!force && (await this.isBlocked())) {
          logger?.debug("CAPTCHA detected, skipping cookie consent check");
          return;
        }
      }

      logger?.debug("Checking for cookie consent", {
        engine: this.engine.name,
        force,
      });

      console.log(chalk.blue("[*] Checking for cookie consent..."));

      // Instant check and click - no polling
      const clicked = await this.page.evaluate(() => {
        // Try to find and click immediately
        const selectors = [
          "button#L2AGLb",
          "button#W0wltc",
          'button[data-ved*="QiZAH"]',
          'div[role="dialog"] button[jsname="V67aGc"]',
          'button[jsname="V67aGc"]',
          'button:contains("Zaakceptuj wszystko")',
          'button:contains("Accept all")',
          'button:contains("Zaakceptuj")',
          'button:contains("I agree")',
          'button:contains("Accept")',
        ];

        for (const selector of selectors) {
          try {
            let button;
            if (selector.includes(":contains")) {
              // Handle text search
              const text = selector.match(/contains\("([^"]+)"\)/)[1];
              const buttons = Array.from(
                document.querySelectorAll('button, div[role="button"]')
              );
              button = buttons.find((el) => {
                const elText = (el.textContent || el.innerText || "").trim();
                return elText.includes(text) && el.offsetParent !== null;
              });
            } else {
              button = document.querySelector(selector);
            }

            if (button && button.offsetParent !== null) {
              console.log(`Dorker: INSTANTLY clicking consent: ${selector}`);
              button.click();
              return true;
            }
          } catch (e) {
            // Continue to next selector
          }
        }
        return false;
      });

      if (clicked) {
        logger?.info("Cookie consent handled instantly");
        console.log(chalk.green("[✅] Cookie consent handled"));
        this.googleConsentHandled = true;
        // No delay at all - continue immediately
      } else {
        logger?.debug("No cookie consent found, continuing");
      }
    } catch (error) {
      logger?.error("Error handling cookie consent", { error: error.message });
      // Don't show error to user, just continue immediately
    }
  }

  async testProxyConnection(proxy) {
    try {
      // Determine proxy type
      const isHTTPProxy =
        proxy.proxy_types &&
        (proxy.proxy_types.includes(1) || proxy.proxy_types.includes("1"));
      const proxyProtocol = isHTTPProxy ? "HTTP" : "SOCKS5";

      logger?.info(`Testing ${proxyProtocol} proxy connection`, {
        host: proxy.host,
        port: proxy.port,
        username: proxy.username,
        proxy_types: proxy.proxy_types,
      });

      // Log full proxy details for debugging
      console.log(chalk.blue("📋 Proxy details:"));
      console.log(chalk.gray(`   Host: ${proxy.host}`));
      console.log(chalk.gray(`   Port: ${proxy.port}`));
      console.log(chalk.gray(`   Username: ${proxy.username}`));
      console.log(
        chalk.gray(
          `   Password: ${
            proxy.password ? "***" + proxy.password.slice(-4) : "Not set"
          }`
        )
      );
      console.log(
        chalk.gray(
          `   Type: ${proxyProtocol} (proxy_types: ${JSON.stringify(
            proxy.proxy_types
          )})`
        )
      );

      console.log(
        chalk.blue(`🔌 Testing ${proxyProtocol} proxy connection...`)
      );

      // Wait for proxy to become active (they need time to initialize)
      console.log(
        chalk.yellow("⏳ Waiting 5 seconds for proxy to become active...")
      );
      await sleep(5000);

      // Import required packages
      const axios = (await import("axios")).default;

      let agent;
      let testUrl = "https://api.ipify.org?format=json";

      if (isHTTPProxy) {
        // For HTTP proxy
        const { HttpsProxyAgent } = await import("https-proxy-agent");
        const proxyUrl = `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
        agent = new HttpsProxyAgent(proxyUrl);
      } else {
        // For SOCKS5 proxy
        const { SocksProxyAgent } = await import("socks-proxy-agent");
        const proxyUrl = `socks5://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
        agent = new SocksProxyAgent(proxyUrl);
      }

      let retries = 3;
      let lastError;

      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          console.log(chalk.blue(`   Attempt ${attempt}/${retries}...`));

          const response = await axios.get(
            "https://api.ipify.org?format=json",
            {
              httpsAgent: agent,
              httpAgent: agent,
              timeout: 30000,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              },
            }
          );

          if (response.data && response.data.ip) {
            console.log(
              chalk.green(`✅ ${proxyProtocol} proxy connection established`)
            );
            console.log(chalk.gray(`   → Proxy IP: ${response.data.ip}`));
            logger?.info(`Proxy test successful (${proxyProtocol})`, {
              proxyIP: response.data.ip,
            });
            return true;
          }
        } catch (err) {
          lastError = err;
          logger?.warn(`${proxyProtocol} proxy attempt ${attempt} failed`, {
            error: err.message,
          });
          console.log(
            chalk.red(`   ❌ Attempt ${attempt} failed: ${err.message}`)
          );

          if (attempt < retries) {
            console.log(
              chalk.yellow(`   ⏳ Waiting 3 seconds before retry...`)
            );
            await sleep(3000);
          }
        }
      }

      console.log(
        chalk.red(`❌ All ${proxyProtocol} proxy connection attempts failed`)
      );
      console.log(
        chalk.yellow(
          `   Last error: ${JSON.stringify(
            lastError?.message || lastError,
            null,
            2
          )}`
        )
      );
      return false;
    } catch (err) {
      logger?.error("Unexpected error in proxy test", {
        error: err.message,
      });
      return false;
    }
  }

  async hasProxyError() {
    try {
      logger?.debug("Checking for proxy connection errors");

      const hasError = await this.page.evaluate(() => {
        const pageText =
          document.body?.innerText || document.body?.textContent || "";
        const currentUrl = window.location.href;
        const pageTitle = document.title || "";

        // Check for proxy error messages
        const errorMessages = [
          "No Internet",
          "ERR_PROXY_CONNECTION_FAILED",
          "There is something wrong with the proxy server",
          "proxy server or the address is incorrect",
          "Contacting the system admin",
          "Checking the proxy address",
          "This site can't be reached",
          "took too long to respond",
          "Check your Internet connection",
          "ERR_INTERNET_DISCONNECTED",
          "ERR_NETWORK_CHANGED",
        ];

        const hasErrorText = errorMessages.some(
          (msg) =>
            pageText.toLowerCase().includes(msg.toLowerCase()) ||
            pageTitle.toLowerCase().includes(msg.toLowerCase())
        );

        // Check for Chrome error page indicators
        const isChromeErrorPage =
          pageText.includes("Chrome error") ||
          currentUrl.includes("chrome-error://") ||
          pageText.includes("This webpage is not available");

        return hasErrorText || isChromeErrorPage;
      });

      if (hasError) {
        logger?.warn("Proxy error detected on current page");
      }

      return hasError;
    } catch (error) {
      logger?.debug("Error checking for proxy errors", {
        error: error.message,
      });
      return false;
    }
  }

  async isBlocked() {
    try {
      logger?.debug("Checking if page is blocked/CAPTCHA");

      // First check for proxy errors
      const hasProxyError = await this.hasProxyError();
      if (hasProxyError) {
        logger?.warn("Proxy error detected, treating as blocked");
        return true;
      }

      // Enhanced detection for dynamically loaded CAPTCHAs
      const result = await Promise.race([
        (async () => {
          try {
            const pageUrl = this.page.url();

            // First, quick URL check
            if (
              pageUrl.includes("/sorry/") ||
              pageUrl.includes("ipv4.google.com/sorry")
            ) {
              logger?.warn("CAPTCHA URL detected", { url: pageUrl });
              return true;
            }

            // Wait a bit for dynamic content to load
            await sleep(1000);

            // Check for dynamic CAPTCHA elements multiple times
            for (let check = 0; check < 3; check++) {
              const hasCaptchaElement = await this.page.evaluate(() => {
                // Check for Google's automated query blocking message (requires manual intervention)
                const doscaptchaElement = document.querySelector(
                  ".rc-doscaptcha-body-text"
                );
                if (doscaptchaElement) {
                  console.log(
                    "Dorker: Found rc-doscaptcha-body-text - Google blocked automated queries, manual intervention required!"
                  );
                  return "manual_required"; // Special return value for this case
                }

                // PRIORITY: Check for Google's text-based image CAPTCHA first (like the user encountered)
                const textImageCaptcha =
                  document.querySelector("#captcha-form") ||
                  document.querySelector('form img[src*="/sorry/image"]') ||
                  document.querySelector(
                    'form:has(img[src*="/sorry/image"])'
                  ) ||
                  document.querySelector('img[src*="captcha"]') ||
                  document.querySelector('input[name="captcha"]') ||
                  document.querySelector(
                    'form input[type="text"][name="captcha"]'
                  ) ||
                  document.querySelector(
                    'form img[alt*="Please enable images"]'
                  );

                if (textImageCaptcha) {
                  console.log(
                    "Dorker: Found text-based image CAPTCHA form - prioritizing image CAPTCHA!"
                  );
                  return "image_captcha";
                }

                // Check for reCAPTCHA iframes (secondary priority)
                const recaptchaFrames = document.querySelectorAll(
                  'iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"]'
                );

                if (recaptchaFrames.length > 0) {
                  console.log(
                    `Dorker: Found ${recaptchaFrames.length} reCAPTCHA iframe(s) - CAPTCHA detected!`
                  );
                  return true;
                }

                // Check for g-recaptcha div
                const gRecaptcha = document.querySelector(
                  ".g-recaptcha, div[data-sitekey]"
                );
                if (gRecaptcha) {
                  console.log(
                    "Dorker: Found g-recaptcha element - CAPTCHA detected!"
                  );
                  return true;
                }

                // Check for CAPTCHA text indicators
                const bodyText = document.body?.innerText || "";
                const captchaPhrases = [
                  "unusual traffic from your computer",
                  "verify that you're not a robot",
                  "prove you're not a robot",
                  "automated queries",
                  "type the characters below",
                  "please enable images",
                ];

                for (const phrase of captchaPhrases) {
                  if (bodyText.toLowerCase().includes(phrase)) {
                    console.log(`Dorker: Found CAPTCHA phrase: "${phrase}"`);
                    return true;
                  }
                }

                // Check for hCaptcha
                if (
                  document.querySelector('.h-captcha, iframe[src*="hcaptcha"]')
                ) {
                  console.log("Dorker: hCaptcha detected!");
                  return true;
                }

                // Check for Cloudflare challenge
                if (
                  document.querySelector(
                    "#cf-challenge-running, .cf-challenge-running"
                  )
                ) {
                  console.log("Dorker: Cloudflare challenge detected!");
                  return true;
                }

                return false;
              });

              if (hasCaptchaElement) {
                if (hasCaptchaElement === "manual_required") {
                  logger?.warn(
                    "Google automated query blocking detected - manual intervention required"
                  );
                  console.log(
                    chalk.red(
                      "🚫 Google has detected automated queries and blocked auto-solving."
                    )
                  );
                  console.log(
                    chalk.yellow(
                      "⚠️  This requires manual CAPTCHA solving regardless of auto-solve settings."
                    )
                  );
                  return "manual_required";
                } else if (hasCaptchaElement === "image_captcha") {
                  logger?.warn("Image CAPTCHA detected");
                  console.log(chalk.yellow("🖼️ Image CAPTCHA detected"));
                  return "image_captcha";
                } else {
                  logger?.warn("CAPTCHA element detected in DOM");
                  return true;
                }
              }

              // If not found yet, wait a bit more for dynamic loading
              if (check < 2) {
                await sleep(500);
              }
            }

            // Final check - look at page content
            const pageContent = await this.page.content();
            const pageTitle = await this.page.title();

            // Cookie consent check (to avoid false positives)
            const cookieConsentIndicators = [
              "accept all cookies",
              "zaakceptuj wszystko",
              "we use cookies",
              "manage cookie settings",
            ];

            const hasCookieConsent = cookieConsentIndicators.some((indicator) =>
              pageContent.toLowerCase().includes(indicator.toLowerCase())
            );

            if (hasCookieConsent) {
              logger?.debug("Cookie consent detected, not a CAPTCHA");
              return false;
            }

            // Check page title for CAPTCHA indicators
            if (
              pageTitle.toLowerCase().includes("sorry") ||
              pageTitle.toLowerCase().includes("captcha")
            ) {
              logger?.warn("CAPTCHA detected in page title", {
                title: pageTitle,
              });
              return true;
            }

            logger?.debug("No CAPTCHA detected after thorough check");
            return false;
          } catch (error) {
            logger?.warn("Error checking page content for blocking", {
              error: error.message,
            });
            return false;
          }
        })(),
        // Timeout after 5 seconds
        sleep(5000).then(() => {
          logger?.debug("isBlocked check timed out, assuming not blocked");
          return false;
        }),
      ]);

      return result;
    } catch (error) {
      logger?.error("Error in isBlocked method", { error: error.message });
      return false; // Assume not blocked if we can't determine
    }
  }

  async tryAutomaticCaptchaSolving() {
    // This option is now generic for any auto-solving
    if (!this.options.autoSolve) {
      logger?.debug("Automatic CAPTCHA solving is disabled by user setting.");
      return false;
    }

    try {
      // First, determine what kind of block we're facing
      const captchaType = await this.isBlocked();

      // No block detected, so nothing to solve
      if (!captchaType) {
        logger?.debug("No CAPTCHA/block detected, skipping automatic solving.");
        return false;
      }

      // Handle image-based CAPTCHA
      if (captchaType === "image_captcha") {
        logger?.info("Image CAPTCHA detected, attempting to solve with AI.");
        console.log(chalk.cyan("🖼️ Trying to solve image CAPTCHA..."));
        return await this.tryImageCaptchaSolving();
      }

      // Handle reCAPTCHA (which we'll try to solve with audio)
      if (captchaType === true) {
        logger?.info(
          "reCAPTCHA detected, attempting to solve with audio method."
        );
        console.log(chalk.cyan("🎵 Trying to solve audio reCAPTCHA..."));
        return await this.tryAudioCaptchaSolving();
      }

      // If we're here, it's either `manual_required` or another unhandled type.
      // The `manual_required` case will be handled by the error catch block.
      logger?.warn("Unhandled CAPTCHA type or no solver available", {
        captchaType,
      });
      return false;
    } catch (error) {
      if (error.message === "manual_required") {
        logger?.warn("Automated queries detected, switching to manual mode.");
        console.log(
          chalk.red(
            "\n🚫 Automated Queries Detected! Manual intervention required."
          )
        );
        // This special string signals to the caller to start the manual process
        return "manual_required";
      }

      if (error.message.includes("proxy_switched")) {
        logger?.info("Proxy switch signal caught, re-throwing to caller.", {
          signal: error.message,
        });
        throw error; // Re-throw to be handled by the search method
      }

      logger?.error(
        "An unexpected error occurred during automatic CAPTCHA solving.",
        { error: error.message }
      );
      return false;
    }
  }

  async tryImageCaptchaSolving() {
    try {
      console.log(chalk.blue("🖼️ Analyzing image CAPTCHA..."));

      // Get the image CAPTCHA details
      const captchaData = await this.page.evaluate(() => {
        const form =
          document.querySelector("#captcha-form") ||
          document.querySelector('form:has(img[src*="/sorry/image"])') ||
          document.querySelector('form:has(input[name="captcha"])');

        if (!form) return null;

        const img = form.querySelector(
          'img[src*="/sorry/image"], img[src*="captcha"]'
        );
        const input = form.querySelector(
          'input[name="captcha"], input[type="text"]'
        );
        const submitBtn = form.querySelector(
          'input[type="submit"], button[type="submit"], button'
        );

        if (!img || !input) return null;

        return {
          imageUrl: img.src,
          inputSelector: input.name || input.id || 'input[type="text"]',
          submitSelector: submitBtn
            ? submitBtn.name || submitBtn.id || 'input[type="submit"]'
            : null,
          formAction: form.action || null,
        };
      });

      if (!captchaData) {
        console.log(chalk.red("❌ Could not find image CAPTCHA elements"));
        return false;
      }

      console.log(chalk.blue("📸 Found image CAPTCHA, downloading image..."));

      // Download the CAPTCHA image
      const imageBuffer = await this.downloadCaptchaImage(captchaData.imageUrl);
      if (!imageBuffer) {
        console.log(chalk.red("❌ Failed to download CAPTCHA image"));
        return false;
      }

      // Solve the CAPTCHA using OpenRouter.ai
      const solution = await this.solveCaptchaWithOpenRouter(imageBuffer);
      if (!solution) {
        console.log(chalk.red("❌ Failed to solve CAPTCHA with AI"));
        return false;
      }

      console.log(chalk.green(`✅ AI solved CAPTCHA: "${solution}"`));

      // Input the solution using human-like typing behavior
      console.log(
        chalk.blue("📝 Entering CAPTCHA solution with human behavior...")
      );

      // First, focus on the input field
      const inputSelector = `input[name="${captchaData.inputSelector}"], #${captchaData.inputSelector}, ${captchaData.inputSelector}`;
      const inputField = await this.page.$(inputSelector).catch(() => null);

      if (!inputField) {
        console.log(chalk.red("❌ Could not find CAPTCHA input field"));
        return false;
      }

      // Clear any existing text and type the solution with human behavior
      await inputField.click();
      await sleep(200);

      // Select all existing text (if any) and replace it
      await this.page.keyboard.down("Control");
      await this.page.keyboard.press("KeyA");
      await this.page.keyboard.up("Control");
      await sleep(100);

      // Type the solution using enhanced human typing
      await this.typeWithHumanBehavior(solution, inputSelector);

      console.log(chalk.blue("📤 Submitting CAPTCHA solution..."));

      // Add a human-like pause before submitting
      await sleep(Math.random() * 1000 + 500);

      // Submit the form
      const success = await this.page.evaluate(() => {
        const form =
          document.querySelector("#captcha-form") ||
          document.querySelector('form:has(input[name="captcha"])');
        if (form) {
          const submitBtn = form.querySelector(
            'input[type="submit"], button[type="submit"], button'
          );
          if (submitBtn) {
            submitBtn.click();
          } else {
            form.submit();
          }
          return true;
        }
        return false;
      });

      if (!success) {
        console.log(chalk.red("❌ Failed to submit CAPTCHA solution"));
        return false;
      }

      // Wait for page to load after submission
      await sleep(3000);

      // Check if CAPTCHA was solved successfully
      const stillHasCaptcha = await this.isBlocked();
      if (stillHasCaptcha === "image_captcha" || stillHasCaptcha === true) {
        console.log(
          chalk.yellow("⚠️ CAPTCHA still present - solution may be incorrect")
        );
        return false;
      }

      console.log(chalk.green("✅ Image CAPTCHA solved successfully!"));
      return true;
    } catch (error) {
      logger?.error("Error solving image CAPTCHA", { error: error.message });
      console.log(
        chalk.red(`❌ Error solving image CAPTCHA: ${error.message}`)
      );
      return false;
    }
  }

  async downloadCaptchaImage(imageUrl) {
    try {
      console.log(
        chalk.blue(
          `📥 Downloading CAPTCHA image from: ${imageUrl.substring(0, 80)}...`
        )
      );

      const response = await axios({
        method: "GET",
        url: imageUrl,
        responseType: "arraybuffer",
        timeout: 15000,
        headers: {
          "User-Agent": await this.page.evaluate(() => navigator.userAgent),
          Referer: this.page.url(),
          Accept: "image/*,*/*",
        },
      });

      if (response.status === 200 && response.data) {
        console.log(chalk.green("✅ CAPTCHA image downloaded successfully"));
        return Buffer.from(response.data);
      }

      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      logger?.error("Failed to download CAPTCHA image", {
        error: error.message,
      });
      console.log(
        chalk.red(`❌ Failed to download CAPTCHA image: ${error.message}`)
      );
      return null;
    }
  }

  async solveCaptchaWithOpenRouter(imageBuffer) {
    try {
      if (!OPENROUTER_CONFIG.apiKey) {
        console.log(chalk.red("❌ No OpenRouter API key configured"));
        console.log(
          chalk.yellow(
            "   Please set OPENROUTER_API_KEY in your environment variables"
          )
        );
        return null;
      }

      console.log(
        chalk.blue("🤖 Sending CAPTCHA to OpenRouter.ai for solving...")
      );

      // Convert image buffer to base64
      const base64Image = imageBuffer.toString("base64");
      const imageDataUrl = `data:image/jpeg;base64,${base64Image}`;

      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: "google/gemini-flash-1.5",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "This is a CAPTCHA image containing text/characters that I need to read. Please carefully analyze the image and extract the exact text shown. The text may be distorted, have different fonts, colors, or backgrounds, but focus on identifying each character. Respond with ONLY the text/characters you see, nothing else - no explanations, no formatting, just the raw text. Be as accurate as possible.",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: imageDataUrl,
                  },
                },
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: 50,
        },
        {
          headers: {
            Authorization: `Bearer ${OPENROUTER_CONFIG.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/",
            "X-Title": "CAPTCHA Solver",
          },
          timeout: 30000,
        }
      );

      if (response.data && response.data.choices && response.data.choices[0]) {
        const solution = response.data.choices[0].message.content.trim();
        console.log(chalk.green(`🎯 AI solution received: "${solution}"`));
        logger?.info("CAPTCHA solved by OpenRouter.ai", { solution });
        return solution;
      }

      throw new Error("No solution in API response");
    } catch (error) {
      logger?.error("Failed to solve CAPTCHA with OpenRouter.ai", {
        error: error.message,
      });
      console.log(chalk.red(`❌ OpenRouter.ai API error: ${error.message}`));
      return null;
    }
  }

  async tryAudioCaptchaSolving() {
    try {
      logger?.info("Attempting audio CAPTCHA challenge");
      console.log(chalk.cyan("🎵 Trying audio CAPTCHA challenge..."));

      // Step 0: First inject a detector for dynamic reCAPTCHA loading
      console.log(chalk.blue("0️⃣ Setting up dynamic reCAPTCHA detection..."));

      // Inject a MutationObserver to detect when reCAPTCHA elements are added
      await this.page.evaluate(() => {
        window.__recaptchaDetected = false;
        window.__recaptchaCheckbox = null;

        // Create observer to watch for reCAPTCHA elements
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            // Check added nodes
            for (const node of mutation.addedNodes) {
              if (node.nodeType === 1) {
                // Element node
                // Check if it's a reCAPTCHA iframe
                if (
                  node.tagName === "IFRAME" &&
                  (node.src?.includes("recaptcha") ||
                    node.title?.includes("reCAPTCHA"))
                ) {
                  console.log("Dorker: reCAPTCHA iframe detected!");
                  window.__recaptchaDetected = true;
                }

                // Check for checkbox elements
                const checkIfCheckbox = (element) => {
                  if (
                    element.matches &&
                    (element.matches("#recaptcha-anchor") ||
                      element.matches(".recaptcha-checkbox") ||
                      element.matches('[role="checkbox"]'))
                  ) {
                    console.log(
                      "Dorker: reCAPTCHA checkbox found via MutationObserver"
                    );
                    window.__recaptchaCheckbox = element;
                    return true;
                  }

                  // Check children recursively
                  if (element.querySelectorAll) {
                    const checkboxes = element.querySelectorAll(
                      '#recaptcha-anchor, .recaptcha-checkbox, [role="checkbox"]'
                    );
                    if (checkboxes.length > 0) {
                      console.log(
                        "Dorker: reCAPTCHA checkbox found in children"
                      );
                      window.__recaptchaCheckbox = checkboxes[0];
                      return true;
                    }
                  }
                  return false;
                };

                checkIfCheckbox(node);
              }
            }
          }
        });

        // Start observing the entire document
        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });

        console.log("Dorker: MutationObserver set up for reCAPTCHA detection");
      });

      // Step 1: Wait for reCAPTCHA to be dynamically loaded and find checkbox
      console.log(
        chalk.blue("1️⃣ Waiting for reCAPTCHA to load dynamically...")
      );

      // Create progress bar for checkbox detection
      const checkboxProgressBar = new cliProgress.SingleBar({
        format:
          "   {bar} | {percentage}% | Finding reCAPTCHA checkbox... ({value}/{total})",
        barCompleteChar: "\u2588",
        barIncompleteChar: "\u2591",
        hideCursor: true,
      });

      checkboxProgressBar.start(30, 0);
      let checkboxClicked = false;

      for (let attempt = 0; attempt < 30; attempt++) {
        checkboxProgressBar.update(attempt + 1);

        try {
          // Method 1: Try using Puppeteer's frame API to access iframe content
          const frames = await this.page.frames();

          // Look for reCAPTCHA anchor frame
          for (const frame of frames) {
            const frameUrl = frame.url();

            // Check if this is the reCAPTCHA anchor frame
            if (
              frameUrl.includes("recaptcha") &&
              frameUrl.includes("/anchor")
            ) {
              checkboxProgressBar.stop();
              console.log(chalk.green("✅ Found reCAPTCHA anchor frame!"));

              try {
                // Try to find and click checkbox inside the iframe
                const checkboxInFrame = await frame.$("#recaptcha-anchor");
                if (checkboxInFrame) {
                  console.log(
                    chalk.green("✅ Found checkbox inside reCAPTCHA frame!")
                  );
                  await checkboxInFrame.click();
                  checkboxClicked = true;
                  break;
                }

                // Try alternative selectors in the frame
                const alternativeSelectors = [
                  "span.recaptcha-checkbox",
                  ".recaptcha-checkbox",
                  '[role="checkbox"]',
                  "div.recaptcha-checkbox-border",
                ];

                for (const selector of alternativeSelectors) {
                  const element = await frame.$(selector);
                  if (element) {
                    console.log(
                      chalk.green(
                        `✅ Found checkbox with selector: ${selector}`
                      )
                    );
                    await element.click();
                    checkboxClicked = true;
                    break;
                  }
                }

                if (checkboxClicked) break;
              } catch (frameError) {
                logger?.debug("Error accessing frame content", {
                  error: frameError.message,
                });
              }
            }
          }

          if (checkboxClicked) {
            checkboxProgressBar.stop();
            console.log(
              chalk.green("✅ Checkbox clicked successfully via frame API!")
            );
            break;
          }

          // Method 2: Try page.evaluate to check main document for reCAPTCHA presence
          await this.page.evaluate(() => {
            // Check for reCAPTCHA container
            const gRecaptcha = document.querySelector(".g-recaptcha");
            if (gRecaptcha) {
              console.log("Dorker: Found g-recaptcha container");

              // Find the iframe inside
              const iframe = gRecaptcha.querySelector(
                'iframe[title="reCAPTCHA"]'
              );
              if (iframe) {
                console.log(
                  `Dorker: Found reCAPTCHA iframe with name: ${iframe.name}`
                );
              }
            }

            // Check for standalone iframe
            const standaloneIframe = document.querySelector(
              'iframe[src*="recaptcha"][src*="/anchor"]'
            );
            if (standaloneIframe) {
              console.log(`Dorker: Found standalone reCAPTCHA iframe`);
            }
          });

          // Method 3: Try clicking on the iframe area itself (sometimes works)
          if (!checkboxClicked && attempt > 10) {
            const iframeClicked = await this.page.evaluate(() => {
              const iframe = document.querySelector(
                'iframe[title="reCAPTCHA"]'
              );
              if (iframe) {
                const rect = iframe.getBoundingClientRect();
                // Click in the area where the checkbox usually is (left side of iframe)
                const clickX = rect.left + 30;
                const clickY = rect.top + rect.height / 2;

                // Create and dispatch click event
                const clickEvent = new MouseEvent("click", {
                  view: window,
                  bubbles: true,
                  cancelable: true,
                  clientX: clickX,
                  clientY: clickY,
                });

                document
                  .elementFromPoint(clickX, clickY)
                  ?.dispatchEvent(clickEvent);
                return true;
              }
              return false;
            });

            if (iframeClicked) {
              // Wait to see if it worked
              await sleep(1000);

              // Check if challenge appeared
              const challengeAppeared = await this.page.evaluate(() => {
                return document.querySelector('iframe[src*="bframe"]') !== null;
              });

              if (challengeAppeared) {
                checkboxProgressBar.stop();
                console.log(
                  chalk.green(
                    "✅ Challenge frame appeared - checkbox click worked!"
                  )
                );
                checkboxClicked = true;
                break;
              }
            }
          }
        } catch (error) {
          logger?.debug("Error in checkbox detection attempt", {
            attempt: attempt + 1,
            error: error.message,
          });
        }

        // Wait before next attempt
        await sleep(500);
      }

      checkboxProgressBar.stop();

      if (!checkboxClicked) {
        logger?.debug("No reCAPTCHA checkbox found after extended waiting");
        console.log(
          chalk.yellow(
            "⚠️ No checkbox found after 15 seconds, trying direct audio approach"
          )
        );
      }

      // Step 2: Wait for challenge interface and audio button (dynamic loading)
      console.log(chalk.blue("2️⃣ Waiting for challenge interface to load..."));

      // If checkbox was clicked, wait for challenge to appear
      if (checkboxClicked) {
        await sleep(2000);

        // Check if a new window/iframe opened for the challenge
        const frames = await this.page.frames();
        console.log(chalk.gray(`   Found ${frames.length} frames on page`));

        // Look for challenge frame
        for (const frame of frames) {
          const frameUrl = frame.url();
          if (frameUrl.includes("recaptcha") && frameUrl.includes("bframe")) {
            console.log(chalk.green("✅ Found reCAPTCHA challenge frame"));
            logger?.debug("reCAPTCHA challenge frame detected", {
              url: frameUrl,
            });
          }
        }
      }

      // Inject observer for audio button
      await this.page.evaluate(() => {
        window.__audioButtonFound = false;

        // Create observer for audio button
        const audioObserver = new MutationObserver((mutations) => {
          // Audio button selectors
          const audioSelectors = [
            "#recaptcha-audio-button",
            "button.rc-button-audio",
            'button[title*="audio"]',
            ".rc-button.goog-inline-block.rc-button-audio",
          ];

          for (const selector of audioSelectors) {
            const button = document.querySelector(selector);
            if (button && !window.__audioButtonFound) {
              console.log(
                `Dorker: Audio button detected via MutationObserver: ${selector}`
              );
              window.__audioButtonFound = true;
              // Try to click it immediately
              setTimeout(() => button.click(), 100);
              break;
            }
          }
        });

        audioObserver.observe(document.body, {
          childList: true,
          subtree: true,
        });
      });

      console.log(chalk.blue("3️⃣ Looking for audio challenge button..."));

      // Create progress bar for audio button detection
      const audioProgressBar = new cliProgress.SingleBar({
        format:
          "   {bar} | {percentage}% | Searching for audio button... ({value}/{total})",
        barCompleteChar: "\u2588",
        barIncompleteChar: "\u2591",
        hideCursor: true,
      });

      audioProgressBar.start(20, 0);
      let audioButtonFound = false;

      for (let attempt = 0; attempt < 20; attempt++) {
        audioProgressBar.update(attempt + 1);

        try {
          // Look for the bframe (challenge frame)
          const frames = await this.page.frames();
          let bframe = null;

          for (const frame of frames) {
            const frameUrl = frame.url();
            if (frameUrl.includes("recaptcha") && frameUrl.includes("bframe")) {
              bframe = frame;
              audioProgressBar.stop();
              console.log(chalk.green("✅ Found challenge bframe"));
              break;
            }
          }

          if (bframe) {
            // Try to find audio button inside the bframe
            const audioButtonSelectors = [
              "#recaptcha-audio-button",
              "button.rc-button-audio",
              'button[title*="Get an audio challenge"]',
              'button[title*="audio"]',
              'button[aria-label*="audio"]',
              ".rc-button.rc-button-audio",
              "button.goog-inline-block.rc-button-audio",
              ".rc-buttons button.rc-button-audio",
            ];

            for (const selector of audioButtonSelectors) {
              try {
                const audioButton = await bframe.$(selector);
                if (audioButton) {
                  audioProgressBar.stop();
                  console.log(
                    chalk.green(`✅ Found audio button in bframe: ${selector}`)
                  );
                  await audioButton.click();
                  audioButtonFound = true;
                  console.log(
                    chalk.green(
                      "✅ Audio challenge button clicked successfully!"
                    )
                  );
                  break;
                }
              } catch (e) {
                // Continue with next selector
              }
            }

            if (!audioButtonFound) {
              // Check if we're in image challenge mode
              const isImageChallenge = await bframe.evaluate(() => {
                return (
                  document.querySelector(
                    "#rc-imageselect, .rc-imageselect-challenge"
                  ) !== null
                );
              });

              if (isImageChallenge) {
                logger?.debug(
                  "Image challenge detected, looking for audio button"
                );
              }
            }
          }
        } catch (error) {
          logger?.debug("Error accessing frames for audio button", {
            attempt: attempt + 1,
            error: error.message,
          });
        }

        if (audioButtonFound) {
          // Wait a moment for the click to take effect
          await sleep(1000);
          break;
        }

        await sleep(500);
      }

      audioProgressBar.stop();

      if (!audioButtonFound) {
        logger?.debug("No audio challenge button found");
        console.log(chalk.red("❌ No audio challenge button found"));
        return false;
      }

      // Step 4: Wait for audio challenge interface to load
      console.log(chalk.blue("4️⃣ Waiting for audio challenge to load..."));
      await sleep(3000);

      // Step 4.5: Check for automated queries blocking message
      console.log(chalk.blue("🔍 Checking for automated queries blocking..."));

      try {
        const frames = await this.page.frames();
        let bframe = null;

        for (const frame of frames) {
          const frameUrl = frame.url();
          if (frameUrl.includes("recaptcha") && frameUrl.includes("bframe")) {
            bframe = frame;
            break;
          }
        }

        if (bframe) {
          const automatedQueriesDetected = await bframe.evaluate(() => {
            // Look for the automated queries message
            const messageSelectors = [
              'div:contains("automated queries")',
              'div:contains("can\'t process your request")',
              'div:contains("protect our users")',
              'div:contains("help page")',
              'div:contains("Your computer or network may be sending")',
              ".rc-doscaptcha-header",
              ".rc-doscaptcha-body",
            ];

            // Check text content for the message
            const textContent =
              document.body.textContent || document.body.innerText || "";
            if (
              textContent.includes("automated queries") ||
              textContent.includes("can't process your request") ||
              textContent.includes("protect our users") ||
              textContent.includes("Your computer or network may be sending")
            ) {
              console.log(
                "Dorker: Automated queries blocking message detected"
              );
              return true;
            }

            // Also check for specific elements
            for (const selector of messageSelectors.slice(-2)) {
              // Check the class-based selectors
              if (document.querySelector(selector)) {
                console.log(
                  `Dorker: Automated queries blocking element found: ${selector}`
                );
                return true;
              }
            }

            return false;
          });

          if (automatedQueriesDetected) {
            logger?.warn(
              "Automated queries blocking detected - attempting proxy switch first"
            );
            console.log(chalk.red("🚫 Automated Queries Detected!"));

            // First try proxy switching if enabled - pass currentDork
            const proxySwitchSuccessful =
              await this.handleAutomatedQueriesWithProxySwitch(
                this.currentDork
              );

            if (proxySwitchSuccessful) {
              console.log(
                chalk.green("✅ Proxy switched successfully - retrying search")
              );
              logger?.info("Proxy switch successful, search will be retried");
              // Throw special error to signal search retry needed - this will exit tryAudioCaptchaSolving immediately
              throw new Error("proxy_switched_retry");
            }

            // If proxy switch failed or not enabled, fall back to manual mode
            console.log(
              chalk.yellow(
                "🔄 Proxy switch failed or not enabled - switching to manual mode"
              )
            );
            console.log(
              chalk.yellow("Google has blocked automated CAPTCHA solving.")
            );
            console.log(
              chalk.cyan(
                "📖 Please complete the CAPTCHA manually in the browser window."
              )
            );
            console.log(
              chalk.cyan(
                "The browser window will remain open for manual completion."
              )
            );
            console.log(
              chalk.blue("⏳ Waiting for manual CAPTCHA completion...")
            );
            console.log(chalk.gray("Press Ctrl+C to exit if needed."));

            try {
              // Wait for both CAPTCHA disappearance AND redirect away from sorry page
              await this.page.waitForFunction(
                () => {
                  const noCaptcha = !document.querySelector(
                    'iframe[src*="recaptcha"]'
                  );
                  const notSorryPage = !window.location.href.includes("/sorry");
                  return noCaptcha && notSorryPage;
                },
                { timeout: 300000 } // 5-minute timeout
              );

              console.log(
                chalk.green("✅ CAPTCHA solved manually! Resuming...")
              );
              logger?.info(
                "Manual CAPTCHA completed and redirected away from sorry page."
              );
              await sleep(2000);
              return true;
            } catch (error) {
              // If timeout, check current status
              const currentUrl = this.page.url();
              const stillOnSorry = currentUrl.includes("/sorry");
              const hasCaptcha = await this.page
                .$('iframe[src*="recaptcha"]')
                .catch(() => null);

              logger?.warn("Timeout waiting for manual CAPTCHA solve", {
                error: error.message,
                currentUrl,
                stillOnSorry,
                hasCaptcha: !!hasCaptcha,
              });

              if (stillOnSorry) {
                console.log(
                  chalk.red(
                    "❌ Still on Google sorry page - CAPTCHA may need to be solved again."
                  )
                );
              } else {
                console.log(
                  chalk.yellow(
                    "⚠️ Timeout but may have been redirected - continuing..."
                  )
                );
                return true;
              }

              console.log(
                chalk.red("❌ Timed out waiting for manual CAPTCHA completion.")
              );
              return false;
            }
          }
        }
      } catch (error) {
        // If this is a proxy switch success, re-throw it to exit the function
        if (error.message === "proxy_switched_success") {
          console.log(
            chalk.green(
              "🔄 Proxy switch successful - exiting audio CAPTCHA flow for fresh detection"
            )
          );
          logger?.info(
            "Re-throwing proxy_switched_success to exit tryAudioCaptchaSolving"
          );
          throw error;
        }

        // If this is a proxy switch retry, re-throw it to exit the function
        if (error.message === "proxy_switched_retry") {
          console.log(
            chalk.green(
              "🔄 Proxy switch completed - exiting audio CAPTCHA flow"
            )
          );
          logger?.info(
            "Re-throwing proxy_switched_retry to exit tryAudioCaptchaSolving"
          );
          throw error;
        }

        console.log(
          chalk.yellow(
            `⚠️ Error checking for automated queries: ${error.message}`
          )
        );
        // Continue with normal flow if check fails
      }

      // Before continuing with audio CAPTCHA steps, verify we're still on a CAPTCHA page
      const currentUrl = this.page.url();
      if (!currentUrl.includes("/sorry") && !currentUrl.includes("recaptcha")) {
        console.log(
          chalk.yellow("🚦 Not on CAPTCHA page anymore - exiting audio flow")
        );
        logger?.info("Page is not a CAPTCHA page, exiting audio solving", {
          url: currentUrl,
        });
        return false;
      }

      // Step 5: Check for download button that redirects to MP3
      console.log(chalk.blue("5️⃣ Checking for download button..."));

      let downloadButtonClicked = false;

      try {
        const frames = await this.page.frames();
        let bframe = null;

        for (const frame of frames) {
          const frameUrl = frame.url();
          if (frameUrl.includes("recaptcha") && frameUrl.includes("bframe")) {
            bframe = frame;
            break;
          }
        }

        if (bframe) {
          let captchaSolved = false;
          const maxAttempts = 3; // Max 3 attempts for "multiple correct"

          for (
            let attempt = 1;
            attempt <= maxAttempts && !captchaSolved;
            attempt++
          ) {
            if (attempt > 1) {
              console.log(
                chalk.blue(`🔄 CAPTCHA Attempt #${attempt}/${maxAttempts}`)
              );
            }

            // Look for download button
            const downloadButtonSelectors = [
              'a[href*="payload/audio"]',
              'a[href*=".mp3"]',
              ".rc-audiochallenge-tdownload-link",
              ".rc-audiochallenge-tdownload a",
              "a:contains('Download')",
              "button:contains('Download')",
              '[title*="download"]',
              '[aria-label*="download"]',
            ];

            let downloadButtonFound = false;
            for (const selector of downloadButtonSelectors) {
              try {
                const downloadButton = await bframe.$(selector);
                if (downloadButton) {
                  downloadButtonFound = true;
                  console.log(
                    chalk.green(`✅ Found download button: ${selector}`)
                  );

                  // Extract the download URL from the button/link
                  const downloadUrl = await bframe.evaluate((sel) => {
                    const element = document.querySelector(sel);
                    if (element) {
                      return (
                        element.href ||
                        element.getAttribute("data-href") ||
                        element.getAttribute("data-url")
                      );
                    }
                    return null;
                  }, selector);

                  if (
                    downloadUrl &&
                    (downloadUrl.includes("payload/audio") ||
                      downloadUrl.includes(".mp3"))
                  ) {
                    console.log(
                      chalk.blue(
                        `🎯 Found audio URL: ${downloadUrl.substring(0, 80)}...`
                      )
                    );

                    try {
                      // Download and process audio only once per URL
                      const tempAudioPath = await this.downloadAudioFile(
                        downloadUrl
                      );
                      if (tempAudioPath) {
                        const transcription = await this.solveAudioCaptcha(
                          tempAudioPath
                        );

                        if (transcription) {
                          const inputSuccess = await bframe.evaluate((text) => {
                            const input =
                              document.querySelector("#audio-response");
                            if (input && input.offsetParent !== null) {
                              input.focus();
                              input.value = text;
                              input.dispatchEvent(
                                new Event("input", { bubbles: true })
                              );
                              return true;
                            }
                            return false;
                          }, transcription);

                          if (inputSuccess) {
                            await sleep(500);
                            const submitSuccess = await bframe.evaluate(() => {
                              const button = document.querySelector(
                                "#recaptcha-verify-button"
                              );
                              if (button && button.offsetParent !== null) {
                                button.click();
                                return true;
                              }
                              return false;
                            });

                            if (submitSuccess) {
                              await sleep(4000); // Wait for verification

                              const isCaptchaGone = await this.page.evaluate(
                                () =>
                                  !document.querySelector(
                                    'iframe[src*="recaptcha"]'
                                  )
                              );

                              if (isCaptchaGone) {
                                console.log(
                                  chalk.green("✅ CAPTCHA solved successfully!")
                                );
                                captchaSolved = true;
                                // Clean up audio file only after successful solution
                                try {
                                  await fs.unlink(tempAudioPath);
                                } catch (_) {
                                  // Non-critical error
                                }
                                break; // Exit the download selector loop
                              }

                              const errorText = await bframe.evaluate(() => {
                                const errorElement = document.querySelector(
                                  ".rc-audiochallenge-error-message"
                                );
                                return errorElement
                                  ? errorElement.textContent
                                  : "";
                              });

                              if (
                                errorText.includes("Multiple correct") ||
                                errorText.includes("try again")
                              ) {
                                console.log(
                                  chalk.yellow(
                                    `⚠️ ${errorText}. Need to get new audio challenge...`
                                  )
                                );
                                // Keep the file for potential retry with new audio
                              } else if (!isCaptchaGone) {
                                console.log(
                                  chalk.yellow(
                                    "⚠️ CAPTCHA not solved, verification failed"
                                  )
                                );
                              }
                            }
                          }
                        } else {
                          console.log(
                            chalk.yellow("⚠️ Failed to transcribe audio")
                          );
                        }
                      }

                      // Stop trying other selectors once we found and processed an audio URL
                      downloadButtonFound = true;
                      break;
                    } catch (downloadError) {
                      console.log(
                        chalk.red(
                          `❌ Error during audio processing: ${downloadError.message}`
                        )
                      );
                    }
                  }
                  if (captchaSolved) break;
                }
              } catch (e) {
                // Continue
              }
            }
            if (!downloadButtonFound && attempt === 1) {
              console.log(
                chalk.yellow("⚠️ No download button found, trying fallback.")
              );
              break; // Exit loop to go to fallback
            }
            if (captchaSolved) break;
          }

          if (captchaSolved) {
            logger?.info(
              "Audio CAPTCHA solved successfully with local download method."
            );
            return true;
          }
        }
      } catch (error) {
        console.log(
          chalk.yellow(
            `⚠️ Error checking for download button: ${error.message}`
          )
        );
      }

      if (downloadButtonClicked) {
        console.log(chalk.green("✅ Download button clicked"));
      }

      // Step 6: Find and click the audio-response input to get audio URL redirect (fallback)
      console.log(chalk.blue("6️⃣ Looking for audio-response input field..."));

      let audioResponseClicked = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          // Find the bframe again
          const frames = await this.page.frames();
          let bframe = null;

          for (const frame of frames) {
            const frameUrl = frame.url();
            if (frameUrl.includes("recaptcha") && frameUrl.includes("bframe")) {
              bframe = frame;
              break;
            }
          }

          if (bframe) {
            // Look for audio-response input field inside bframe
            const audioResponseSelectors = [
              "#audio-response",
              'input[id="audio-response"]',
              "input.rc-response-input-field",
              'input[aria-labelledby="rc-response-input-label"]',
              '#rc-audio input[type="text"]',
              ".rc-audiochallenge-response-field input",
              'input[name="recaptcha-audio-response"]',
              'input[placeholder*="audio"]',
              'input[aria-label*="audio"]',
            ];

            for (const selector of audioResponseSelectors) {
              try {
                const audioResponseInput = await bframe.$(selector);
                if (audioResponseInput) {
                  console.log(
                    chalk.green(`✅ Found audio-response input: ${selector}`)
                  );
                  await audioResponseInput.click();
                  audioResponseClicked = true;
                  break;
                }
              } catch (e) {
                // Continue with next selector
              }
            }
          }
        } catch (error) {
          console.log(
            chalk.yellow(
              `   Error accessing audio-response input: ${error.message}`
            )
          );
        }

        if (audioResponseClicked) {
          console.log(
            chalk.green("✅ Audio-response input clicked successfully")
          );
          break;
        }

        await sleep(500);
        console.log(
          chalk.gray(
            `   Attempt ${attempt + 1}/12 - Waiting for audio-response input...`
          )
        );
      }

      if (!audioResponseClicked) {
        logger?.warn("Could not find audio-response input after waiting");
        console.log(
          chalk.yellow(
            "⚠️ No audio-response input found after 6 seconds, continuing anyway..."
          )
        );
      } else {
        await sleep(1000); // Wait for audio redirection/loading
      }

      // Step 7: Extract the audio URL (after clicking audio-response input)
      console.log(chalk.blue("7️⃣ Extracting audio URL..."));
      let audioUrl = null;

      try {
        // Find the bframe again
        const frames = await this.page.frames();
        let bframe = null;

        for (const frame of frames) {
          const frameUrl = frame.url();
          if (frameUrl.includes("recaptcha") && frameUrl.includes("bframe")) {
            bframe = frame;
            break;
          }
        }

        if (bframe) {
          // Extract audio URL from inside bframe (after input click should load audio)
          audioUrl = await bframe.evaluate(() => {
            // Look for audio element (should be loaded after clicking input)
            const audioSelectors = [
              "#audio-source",
              "audio#audio-source",
              "#rc-audio audio",
              ".rc-audiochallenge-control audio",
              'audio[src*="recaptcha"]',
              'audio[src*="payload"]',
              "audio", // Generic fallback
            ];

            for (const selector of audioSelectors) {
              const audioElement = document.querySelector(selector);
              if (audioElement && audioElement.src) {
                console.log(`Dorker: Found audio element: ${selector}`);
                return audioElement.src;
              }
            }

            // Also look for download link as fallback
            const downloadLink = document.querySelector(
              '.rc-audiochallenge-tdownload-link, a[href*=".mp3"], a[href*="payload/audio"], .rc-audiochallenge-tdownload a'
            );
            if (downloadLink && downloadLink.href) {
              console.log("Dorker: Found audio download link");
              return downloadLink.href;
            }

            // Check if the audio-response input itself has a value or data attribute pointing to audio
            const audioInput = document.querySelector("#audio-response");
            if (audioInput) {
              // Check for data attributes that might contain audio URL
              const dataAttrs = [
                "data-audio-url",
                "data-src",
                "data-audio-src",
              ];
              for (const attr of dataAttrs) {
                const url = audioInput.getAttribute(attr);
                if (url) {
                  console.log(
                    `Dorker: Found audio URL in input ${attr}: ${url}`
                  );
                  return url;
                }
              }
            }

            return null;
          });

          if (audioUrl) {
            console.log(chalk.green("✅ Audio URL extracted from bframe"));
          }
        } else {
          console.log(
            chalk.red("❌ Could not find bframe for audio extraction")
          );
        }
      } catch (error) {
        console.log(
          chalk.red(`❌ Error extracting audio URL: ${error.message}`)
        );
      }

      // If no audio URL found immediately, wait and try again (audio might load after input click)
      if (!audioUrl && audioResponseClicked) {
        console.log(
          chalk.yellow("⏳ Waiting for audio to load after input click...")
        );
        await sleep(2000);

        try {
          const frames = await this.page.frames();
          let bframe = frames.find(
            (frame) =>
              frame.url().includes("recaptcha") &&
              frame.url().includes("bframe")
          );

          if (bframe) {
            audioUrl = await bframe.evaluate(() => {
              const audioSelectors = [
                "#audio-source",
                "audio#audio-source",
                "#rc-audio audio",
                ".rc-audiochallenge-control audio",
                'audio[src*="recaptcha"]',
                'audio[src*="payload"]',
                "audio",
              ];

              for (const selector of audioSelectors) {
                const audioElement = document.querySelector(selector);
                if (audioElement && audioElement.src) {
                  console.log(
                    `Dorker: Found audio element after delay: ${selector}`
                  );
                  return audioElement.src;
                }
              }
              return null;
            });

            if (audioUrl) {
              console.log(chalk.green("✅ Audio URL found after delay"));
            }
          }
        } catch (error) {
          console.log(
            chalk.yellow(
              `⚠️ Error checking for delayed audio: ${error.message}`
            )
          );
        }
      }

      if (!audioUrl) {
        logger?.warn("Could not find audio file URL");
        console.log(chalk.red("❌ Could not find audio file URL"));
        return false;
      }

      logger?.info("Found audio challenge, processing with free methods", {
        audioUrl: audioUrl.substring(0, 80),
      });
      console.log(
        chalk.green("✅ Audio URL found, processing with free methods...")
      );

      // Step 8: Solve the audio CAPTCHA using free methods
      console.log(chalk.blue("8️⃣ Transcribing audio..."));
      const transcription = await this.solveAudioCaptcha(audioUrl);
      if (!transcription) {
        logger?.warn("Failed to transcribe audio CAPTCHA");
        console.log(chalk.yellow("⚠️ Audio transcription failed"));
        return false;
      }

      logger?.info("Audio CAPTCHA transcribed successfully", { transcription });
      console.log(chalk.green(`🎯 Audio transcribed: "${transcription}"`));

      // Step 9: Enter the transcription into the input field
      console.log(chalk.blue("9️⃣ Entering transcription..."));
      let inputSuccess = false;

      try {
        // Find the bframe again
        const frames = await this.page.frames();
        let bframe = null;

        for (const frame of frames) {
          const frameUrl = frame.url();
          if (frameUrl.includes("recaptcha") && frameUrl.includes("bframe")) {
            bframe = frame;
            break;
          }
        }

        if (bframe) {
          // Enter transcription inside bframe
          inputSuccess = await bframe.evaluate((text) => {
            const inputSelectors = [
              "#audio-response",
              "input.rc-response-input-field",
              'input[aria-labelledby="rc-response-input-label"]',
              '#rc-audio input[type="text"]',
              ".rc-audiochallenge-response-field input",
              'input[name="recaptcha-audio-response"]',
              'input[placeholder*="audio"]',
              'input[aria-label*="audio"]',
              'input[type="text"]', // Generic fallback
            ];

            for (const selector of inputSelectors) {
              const input = document.querySelector(selector);
              if (input && input.offsetParent !== null) {
                console.log(`Dorker: Found audio input field: ${selector}`);
                input.focus();
                input.value = "";
                input.value = text;

                // Trigger comprehensive input events
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
                input.dispatchEvent(new Event("keyup", { bubbles: true }));

                return true;
              }
            }
            return false;
          }, transcription);

          if (inputSuccess) {
            console.log(chalk.green("✅ Transcription entered successfully"));
          }
        }
      } catch (error) {
        console.log(
          chalk.red(`❌ Error entering transcription: ${error.message}`)
        );
      }

      if (!inputSuccess) {
        logger?.warn("Could not find audio input field");
        console.log(chalk.red("❌ Could not find audio input field"));
        return false;
      }

      // Step 10: Submit the CAPTCHA
      console.log(chalk.blue("🔟 Submitting CAPTCHA..."));
      await sleep(1000);

      let submitSuccess = false;
      try {
        // Find the bframe again
        const frames = await this.page.frames();
        let bframe = null;

        for (const frame of frames) {
          const frameUrl = frame.url();
          if (frameUrl.includes("recaptcha") && frameUrl.includes("bframe")) {
            bframe = frame;
            break;
          }
        }

        if (bframe) {
          // Click submit button inside bframe
          submitSuccess = await bframe.evaluate(() => {
            const buttonSelectors = [
              "#recaptcha-verify-button",
              'button.rc-button-default[id="recaptcha-verify-button"]',
              ".verify-button-holder button",
              ".rc-footer button.rc-button-default",
              'button[type="submit"]',
            ];

            for (const selector of buttonSelectors) {
              const button = document.querySelector(selector);
              if (
                button &&
                button.offsetParent !== null &&
                button.style.display !== "none"
              ) {
                console.log(`Dorker: Clicking submit button: ${selector}`);
                button.click();
                return true;
              }
            }

            // Try finding by text
            const buttons = Array.from(document.querySelectorAll("button"));
            const verifyBtn = buttons.find(
              (btn) =>
                btn.textContent.trim().toUpperCase().includes("VERIFY") ||
                btn.textContent.trim().toUpperCase().includes("SUBMIT")
            );

            if (verifyBtn) {
              console.log("Dorker: Found verify button by text");
              verifyBtn.click();
              return true;
            }

            return false;
          });
        }
      } catch (error) {
        console.log(chalk.red(`❌ Error clicking submit: ${error.message}`));
      }

      if (submitSuccess) {
        console.log(chalk.green("✅ Audio CAPTCHA submitted successfully!"));
        logger?.info("Audio CAPTCHA solved and submitted");

        // Wait for verification and check result
        console.log(chalk.blue("🔟 Waiting for verification..."));
        await sleep(4000);

        // Check if CAPTCHA was solved successfully
        const captchaSolved = await this.page.evaluate(() => {
          // Check if we're still on a CAPTCHA page
          const captchaElements = [
            "#rc-audio",
            '.rc-audiochallenge-error-message:not([style*="display:none"])',
            ".recaptcha-checkbox-checked",
            ".recaptcha-checkbox-checkmark",
          ];

          // If audio challenge is gone or checkbox is checked, likely solved
          const audioChallenge = document.querySelector("#rc-audio");
          const errorMessage = document.querySelector(
            ".rc-audiochallenge-error-message"
          );

          if (
            !audioChallenge ||
            (audioChallenge && audioChallenge.style.display === "none")
          ) {
            return true; // Audio challenge disappeared, good sign
          }

          if (errorMessage && errorMessage.style.display !== "none") {
            return false; // Error message visible, failed
          }

          return true; // Assume success if no error
        });

        if (captchaSolved) {
          console.log(
            chalk.green("🎉 Audio CAPTCHA appears to be solved successfully!")
          );
          return true;
        } else {
          console.log(
            chalk.yellow(
              "⚠️ CAPTCHA verification uncertain, may need manual intervention"
            )
          );
          return false;
        }
      } else {
        logger?.warn("Could not find submit button for audio CAPTCHA");
        console.log(chalk.red("❌ Could not find submit button"));
        return false;
      }
    } catch (error) {
      if (error.message.includes("proxy_switched")) {
        throw error;
      }
      logger?.error("Error in audio CAPTCHA solving", {
        error: error.message,
      });

      throw error; // Re-throw to be handled by tryAutomaticCaptchaSolving
    }
  }

  async handleCaptchaManually(dork) {
    // First, always try automatic solving
    const autoSolvedStatus = await this.tryAutomaticCaptchaSolving(dork);
    if (autoSolvedStatus === true) {
      return true; // Solved automatically
    }

    // If proxy was switched successfully, signal to restart with fresh CAPTCHA detection
    if (autoSolvedStatus === "proxy_switched_success") {
      logger?.info(
        "Proxy switched successfully, restarting search with fresh CAPTCHA detection"
      );
      console.log(
        chalk.green(
          "🔄 Proxy switched successfully - restarting search for fresh CAPTCHA detection"
        )
      );
      return "proxy_switched_success";
    }

    // If proxy was switched, signal to retry the entire search
    if (autoSolvedStatus === "proxy_switched_retry") {
      logger?.info("Proxy switched successfully, search will be retried");
      console.log(
        chalk.green("🔄 Proxy switched - retrying search from beginning")
      );
      return "proxy_switched_retry";
    }

    // If auto-solver specifically asks for manual help, then proceed.
    if (autoSolvedStatus === "manual_required") {
      logger?.info("Waiting for manual CAPTCHA completion", { dork });
      console.log(
        chalk.cyan(
          "Please solve the CAPTCHA in the browser window to continue."
        )
      );
      console.log(
        chalk.blue(
          "The script will automatically resume once the CAPTCHA is solved."
        )
      );

      try {
        // Wait for both CAPTCHA disappearance AND redirect away from sorry page
        await this.page.waitForFunction(
          () => {
            const noCaptcha = !document.querySelector(
              'iframe[src*="recaptcha"]'
            );
            const notSorryPage = !window.location.href.includes("/sorry");
            return noCaptcha && notSorryPage;
          },
          { timeout: 300000 } // 5-minute timeout
        );

        console.log(chalk.green("✅ CAPTCHA solved manually! Resuming..."));
        logger?.info(
          "Manual CAPTCHA appears to be solved and redirected away from sorry page."
        );
        await sleep(2000);
        return true;
      } catch (error) {
        // If timeout, check current status
        const currentUrl = this.page.url();
        const stillOnSorry = currentUrl.includes("/sorry");
        const hasCaptcha = await this.page
          .$('iframe[src*="recaptcha"]')
          .catch(() => null);

        logger?.warn("Timeout waiting for manual CAPTCHA solve", {
          error: error.message,
          currentUrl,
          stillOnSorry,
          hasCaptcha: !!hasCaptcha,
        });

        if (stillOnSorry) {
          console.log(
            chalk.red(
              "❌ Still on Google sorry page - CAPTCHA may need to be solved again."
            )
          );
        } else {
          console.log(
            chalk.yellow(
              "⚠️ Timeout but may have been redirected - continuing..."
            )
          );
          return true;
        }

        console.log(
          chalk.red("❌ Timed out waiting for manual CAPTCHA completion.")
        );
        return false;
      }
    }

    // If we are here, automatic solving failed for a reason other than automated queries.
    logger?.warn(
      "Automatic CAPTCHA solving failed. Manual intervention was not requested."
    );
    return false;
  }

  async waitForUserInput(message) {
    console.log(
      chalk.gray(
        "\n💡 Tip: Type 'skip' to skip this dork, or 'quit' to exit the program"
      )
    );

    const { input } = await inquirer.prompt([
      {
        type: "input",
        name: "input",
        message: chalk.yellow(message),
      },
    ]);

    if (input.toLowerCase() === "skip") {
      throw new Error("SKIP_DORK");
    }

    if (input.toLowerCase() === "quit") {
      console.log(chalk.blue("\n👋 Exiting dorker..."));
      process.exit(0);
    }

    return input;
  }

  async cleanSession() {
    try {
      logger?.debug("Starting session cleanup");

      // Check if page is still available before doing anything
      if (!this.page || this.page.isClosed()) {
        logger?.warn("Page is closed, skipping session cleanup");
        return;
      }

      // Generate new fingerprint for next search
      this.fingerprint = generateRandomFingerprint();
      this.currentViewport = {
        width: this.fingerprint.screen.width,
        height: this.fingerprint.screen.height,
        deviceScaleFactor: this.fingerprint.screen.deviceScaleFactor,
      };

      // Very gentle session cleaning to avoid protocol errors
      try {
        await this.page.evaluate(() => {
          // Clear localStorage and sessionStorage
          try {
            if (window.localStorage) localStorage.clear();
            if (window.sessionStorage) sessionStorage.clear();
          } catch (e) {
            // Ignore errors
          }

          // Reset reCAPTCHA related state
          if (window.___grecaptcha_cfg) {
            window.___grecaptcha_cfg.clients = {};
            window.___grecaptcha_cfg.count = 0;
          }

          // Clear custom detection flags
          window.__recaptchaDetected = false;
          window.__recaptchaCheckbox = null;
          window.__audioButtonFound = false;

          // Clear any error tracking
          window._recaptchaErrors = [];
          window._corsErrors = [];

          // Remove any injected styles or elements that might be detection signals
          const captchaStyles = document.querySelectorAll(
            "style[data-captcha-helper]"
          );
          captchaStyles.forEach((style) => style.remove());

          // Clear cookies via JavaScript
          document.cookie.split(";").forEach(function (c) {
            document.cookie = c
              .replace(/^ +/, "")
              .replace(
                /=.*/,
                "=;expires=" + new Date().toUTCString() + ";path=/"
              );
          });

          // Clear IndexedDB
          if (window.indexedDB && window.indexedDB.databases) {
            window.indexedDB.databases().then((databases) => {
              databases.forEach((db) => {
                window.indexedDB.deleteDatabase(db.name);
              });
            });
          }
        });
      } catch (error) {
        logger?.debug("Local storage cleanup failed (non-critical)", {
          error: error.message,
        });
      }

      // Clear cookies at browser level
      try {
        const cookies = await this.page.cookies();
        if (cookies.length > 0) {
          await this.page.deleteCookie(...cookies);
        }
      } catch (error) {
        logger?.debug("Cookie cleanup failed (non-critical)", {
          error: error.message,
        });
      }

      // Reset CAPTCHA-related flags
      this.googleConsentHandled = false;
      this.captchaCount = 0;

      // Update user agent for next search
      try {
        await this.page.setUserAgent(this.fingerprint.userAgent);
      } catch (error) {
        logger?.debug("User agent update failed (non-critical)", {
          error: error.message,
        });
      }

      // Only change viewport if page is still responsive
      try {
        if (!this.page.isClosed()) {
          await this.page.setViewport(this.currentViewport);
          logger?.debug("Session cleaned with new fingerprint", {
            viewport: this.currentViewport,
            userAgent: this.fingerprint.userAgent.substring(0, 50),
            platform: this.fingerprint.platform,
          });
        }
      } catch (error) {
        logger?.debug("Viewport change failed (non-critical)", {
          error: error.message,
        });
      }

      // Update HTTP headers for new fingerprint
      try {
        await this.page.setExtraHTTPHeaders({
          "Accept-Language": this.fingerprint.languages.join(","),
          "Accept-Encoding": "gzip, deflate, br",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          "Sec-Ch-Ua": `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`,
          "Sec-Ch-Ua-Mobile": "?0",
          "Sec-Ch-Ua-Platform": `"${
            this.fingerprint.platform === "MacIntel"
              ? "macOS"
              : this.fingerprint.platform === "Win32"
              ? "Windows"
              : "Linux"
          }"`,
          "Upgrade-Insecure-Requests": "1",
        });
      } catch (error) {
        logger?.debug("Headers update failed (non-critical)", {
          error: error.message,
        });
      }

      logger?.debug("Session cleanup completed successfully");
    } catch (error) {
      logger?.warn("Session cleaning error", { error: error.message });
    }
  }

  async enhancedHumanSimulation(searchQuery = "", isFirstVisit = false) {
    try {
      logger?.debug("Starting enhanced human simulation", { isFirstVisit });

      // Check if page is still available
      if (!this.page || this.page.isClosed()) {
        logger?.warn("Page is closed, skipping enhanced human simulation");
        return;
      }

      // Simulate realistic user browsing behavior BEFORE searching
      if (isFirstVisit) {
        await this.simulateInitialBrowsingBehavior();
      }

      // Simulate natural page interaction
      await this.simulateNaturalPageInteraction();

      // Add human-like delays based on search complexity
      const searchComplexity =
        searchQuery.length + (searchQuery.match(/[:"]/g) || []).length;
      const thinkingTime = Math.random() * 1000 + searchComplexity * 100;
      await sleep(thinkingTime);

      logger?.debug("Enhanced human simulation completed");
    } catch (error) {
      logger?.warn("Enhanced simulation error", { error: error.message });
    }
  }

  async typeWithHumanBehavior(text, selector) {
    try {
      // Ensure element is focused and cursor is at the end
      await this.cursor.click(selector);
      await sleep(Math.random() * 100 + 50);

      // Move cursor to end of input to ensure proper positioning
      await this.page.keyboard.press("End");
      await sleep(Math.random() * 50 + 25);

      // Simplified human typing - no complex error simulation to avoid cursor jumping
      const words = text.split(" ");

      for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
        const word = words[wordIndex];

        // Add space before word (except first word)
        if (wordIndex > 0) {
          await this.page.keyboard.type(" ");
          // Brief pause after space
          await sleep(Math.random() * 150 + 80);
        }

        // Type each character with realistic but simple delays
        for (let charIndex = 0; charIndex < word.length; charIndex++) {
          const char = word[charIndex];

          // Calculate basic typing delay
          let charDelay = this.calculateBasicTypingDelay(char);

          // Add human variation
          charDelay += (Math.random() - 0.5) * 30;
          charDelay = Math.max(40, Math.min(charDelay, 200)); // Keep delays reasonable

          await this.page.keyboard.type(char);
          await sleep(charDelay);
        }

        // Pause between words
        if (wordIndex < words.length - 1) {
          const wordPause = Math.random() * 100 + 50;
          await sleep(wordPause);
        }
      }

      logger?.debug("Human typing completed", {
        text: text.substring(0, 30),
        length: text.length,
      });
    } catch (error) {
      logger?.debug("Human typing failed, using simple fallback", {
        error: error.message,
      });

      // Simple fallback typing without cursor manipulation
      await this.page.keyboard.type(text, {
        delay: Math.random() * 80 + 60,
      });
    }
  }

  calculateBasicTypingDelay(char) {
    // Simplified typing delay calculation
    let delay = 100; // Base delay

    // Special characters take longer
    const specialChars = [
      ":",
      '"',
      "(",
      ")",
      "[",
      "]",
      "{",
      "}",
      "?",
      "!",
      "@",
      "#",
      "$",
      "%",
      "^",
      "&",
      "*",
    ];
    if (specialChars.includes(char)) {
      delay += 40;
    }

    // Numbers are slightly slower
    if (/\d/.test(char)) {
      delay += 20;
    }

    // Capital letters (Shift key)
    if (/[A-Z]/.test(char)) {
      delay += 25;
    }

    return delay;
  }

  async simulatePageLoadBehavior() {
    try {
      logger?.debug("Simulating natural page load behavior");

      // Wait for page to stabilize
      await sleep(Math.random() * 500 + 300);

      // Check if page loaded successfully (human-like verification)
      await this.page.evaluate(() => {
        // Simulate checking if page loaded by scrolling slightly
        window.scrollBy(0, Math.random() * 100 + 50);
        setTimeout(() => window.scrollBy(0, -(Math.random() * 50 + 25)), 200);
      });

      // Mouse movement during page load
      const viewport = (await this.page.viewport()) || {
        width: 1920,
        height: 1080,
      };
      await this.cursor.moveTo({
        x: Math.random() * viewport.width,
        y: Math.random() * viewport.height,
      });

      await sleep(Math.random() * 400 + 200);
    } catch (error) {
      logger?.debug("Page load simulation failed", { error: error.message });
    }
  }

  async simulatePageRefresh() {
    try {
      logger?.debug("Simulating natural page refresh");

      // Simulate accidental F5 or Ctrl+R
      if (Math.random() < 0.5) {
        await this.page.keyboard.press("F5");
      } else {
        const isMac = this.fingerprint.platform === "MacIntel";
        const ctrlKey = isMac ? "Meta" : "Control";
        await this.page.keyboard.down(ctrlKey);
        await this.page.keyboard.press("KeyR");
        await this.page.keyboard.up(ctrlKey);
      }

      // Wait for page to reload
      await this.page
        .waitForLoadState("domcontentloaded", { timeout: 15000 })
        .catch(() => {
          // Ignore timeout, continue
        });

      await this.simulatePageLoadBehavior();
    } catch (error) {
      logger?.debug("Page refresh simulation failed", { error: error.message });
      // If refresh fails, just continue
    }
  }

  async simulateInitialBrowsingBehavior() {
    try {
      logger?.debug("Simulating initial browsing behavior");

      // Simulate arriving at Google from different sources
      const arrivalSources = [
        "bookmark",
        "direct_type",
        "referral",
        "search_engine",
      ];
      const arrivalSource =
        arrivalSources[Math.floor(Math.random() * arrivalSources.length)];

      // Simulate different arrival behaviors
      switch (arrivalSource) {
        case "bookmark":
          // Quick arrival, minimal exploration
          await sleep(Math.random() * 500 + 200);
          break;
        case "direct_type":
          // Medium arrival, some page exploration
          await this.simulatePageExploration(2000);
          break;
        case "referral":
          // Curious arrival, more exploration
          await this.simulatePageExploration(3000);
          break;
        case "search_engine":
          // Very quick, task-focused
          await sleep(Math.random() * 300 + 100);
          break;
      }

      // Sometimes check other Google services (simulate real user behavior)
      if (Math.random() < 0.2) {
        await this.simulateOtherGoogleServicesInteraction();
      }
    } catch (error) {
      logger?.debug("Initial browsing simulation failed", {
        error: error.message,
      });
    }
  }

  async simulatePageExploration(maxDuration = 3000) {
    try {
      const explorationTime = Math.random() * maxDuration + 500;
      const endTime = Date.now() + explorationTime;

      while (Date.now() < endTime && !this.page.isClosed()) {
        // Random page interactions
        const actions = [
          () => this.simulateScrolling(),
          () => this.simulateMouseMovement(),
          () => this.simulateHoverElements(),
          () => this.simulateReadingPause(),
        ];

        const action = actions[Math.floor(Math.random() * actions.length)];
        await action();

        await sleep(Math.random() * 800 + 200);
      }
    } catch (error) {
      logger?.debug("Page exploration failed", { error: error.message });
    }
  }

  async simulateScrolling() {
    try {
      const scrollPatterns = [
        "slow_read",
        "quick_scan",
        "precise_position",
        "back_and_forth",
      ];
      const pattern =
        scrollPatterns[Math.floor(Math.random() * scrollPatterns.length)];

      switch (pattern) {
        case "slow_read":
          // Simulate reading behavior
          for (let i = 0; i < 3; i++) {
            await this.page.mouse.wheel({ deltaY: 120 });
            await sleep(Math.random() * 1500 + 800); // Reading pause
          }
          break;

        case "quick_scan":
          // Fast scrolling
          for (let i = 0; i < 5; i++) {
            await this.page.mouse.wheel({ deltaY: 240 });
            await sleep(Math.random() * 200 + 100);
          }
          break;

        case "precise_position": {
          // Scroll to specific position
          const targetY = Math.random() * 1000 + 300;
          await this.page.evaluate((y) => {
            window.scrollTo({ top: y, behavior: "smooth" });
          }, targetY);
          await sleep(Math.random() * 1000 + 500);
          break;
        }

        case "back_and_forth":
          // Indecisive scrolling
          await this.page.mouse.wheel({ deltaY: 300 });
          await sleep(Math.random() * 500 + 200);
          await this.page.mouse.wheel({ deltaY: -150 });
          await sleep(Math.random() * 700 + 300);
          break;
      }
    } catch (error) {
      logger?.debug("Scrolling simulation failed", { error: error.message });
    }
  }

  async simulateMouseMovement() {
    try {
      const viewport = (await this.page.viewport()) || {
        width: 1920,
        height: 1080,
      };

      // Generate realistic mouse path
      const _currentPos = await this.page.evaluate(() => ({ x: 0, y: 0 })); // Fallback
      const targetX = Math.random() * viewport.width;
      const targetY = Math.random() * viewport.height;

      // Use ghost cursor for realistic movement
      await this.cursor.moveTo({ x: targetX, y: targetY });

      // Sometimes make micro-adjustments (human behavior)
      if (Math.random() < 0.3) {
        await sleep(Math.random() * 200 + 100);
        await this.cursor.moveTo({
          x: targetX + (Math.random() - 0.5) * 50,
          y: targetY + (Math.random() - 0.5) * 50,
        });
      }
    } catch (error) {
      logger?.debug("Mouse movement simulation failed", {
        error: error.message,
      });
    }
  }

  async simulateHoverElements() {
    try {
      // Find interactive elements to hover
      const interactiveElements = await this.page.$$(
        'a, button, [role="button"], input, select, textarea'
      );

      if (interactiveElements.length > 0) {
        const randomElement =
          interactiveElements[
            Math.floor(Math.random() * Math.min(5, interactiveElements.length))
          ];
        const boundingBox = await randomElement.boundingBox();

        if (boundingBox) {
          await this.cursor.moveTo({
            x: boundingBox.x + boundingBox.width * (0.3 + Math.random() * 0.4),
            y: boundingBox.y + boundingBox.height * (0.3 + Math.random() * 0.4),
          });

          // Hover duration
          await sleep(Math.random() * 800 + 200);

          // Sometimes move away quickly (accidental hover)
          if (Math.random() < 0.3) {
            await this.cursor.moveTo({
              x: boundingBox.x + boundingBox.width + 50,
              y: boundingBox.y + boundingBox.height + 50,
            });
          }
        }
      }
    } catch (error) {
      logger?.debug("Element hover simulation failed", {
        error: error.message,
      });
    }
  }

  async simulateReadingPause() {
    try {
      // Simulate reading/thinking pause
      const pauseDuration = Math.random() * 2000 + 500;
      await sleep(pauseDuration);

      // Sometimes move mouse slightly during pause (natural fidgeting)
      if (Math.random() < 0.4) {
        const currentPos = await this.page.evaluate(() => ({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        }));
        await this.cursor.moveTo({
          x: currentPos.x + (Math.random() - 0.5) * 100,
          y: currentPos.y + (Math.random() - 0.5) * 100,
        });
      }
    } catch (error) {
      logger?.debug("Reading pause simulation failed", {
        error: error.message,
      });
    }
  }

  async simulateOtherGoogleServicesInteraction() {
    try {
      // Simulate checking other Google services (realistic user behavior)
      const services = ["Images", "News", "Maps", "Shopping"];
      const service = services[Math.floor(Math.random() * services.length)];

      // Look for the service link
      const serviceLink = await this.page.$(
        `a[href*="${service.toLowerCase()}"]`
      );
      if (serviceLink) {
        // Hover over it briefly
        const boundingBox = await serviceLink.boundingBox();
        if (boundingBox) {
          await this.cursor.moveTo({
            x: boundingBox.x + boundingBox.width / 2,
            y: boundingBox.y + boundingBox.height / 2,
          });
          await sleep(Math.random() * 1000 + 300);

          // Move away without clicking (just browsing)
          await this.cursor.moveTo({
            x: boundingBox.x + 200,
            y: boundingBox.y + 100,
          });
        }
      }
    } catch (error) {
      logger?.debug("Google services interaction simulation failed", {
        error: error.message,
      });
    }
  }

  async simulateNaturalPageInteraction() {
    try {
      // Simulate natural page interaction patterns
      const interactions = [
        () => this.simulateKeyboardShortcuts(),
        () => this.simulateRightClick(),
        () => this.simulateTextSelection(),
        () => this.simulateTabNavigation(),
      ];

      // Randomly perform 1-2 interactions
      const numInteractions = Math.floor(Math.random() * 2) + 1;
      for (let i = 0; i < numInteractions; i++) {
        if (Math.random() < 0.6) {
          // 60% chance per interaction
          const interaction =
            interactions[Math.floor(Math.random() * interactions.length)];
          await interaction();
          await sleep(Math.random() * 500 + 200);
        }
      }
    } catch (error) {
      logger?.debug("Natural page interaction failed", {
        error: error.message,
      });
    }
  }

  async simulateKeyboardShortcuts() {
    try {
      const shortcuts = [
        () => this.page.keyboard.press("F5"), // Refresh (but cancel quickly)
        () => {
          // Ctrl+F (but cancel)
          this.page.keyboard.down("Control");
          this.page.keyboard.press("KeyF");
          this.page.keyboard.up("Control");
          setTimeout(() => this.page.keyboard.press("Escape"), 100);
        },
        () => this.page.keyboard.press("Home"), // Go to top
        () => this.page.keyboard.press("End"), // Go to bottom
      ];

      if (Math.random() < 0.3) {
        // 30% chance of keyboard shortcut
        const shortcut =
          shortcuts[Math.floor(Math.random() * shortcuts.length)];
        await shortcut();
      }
    } catch (error) {
      logger?.debug("Keyboard shortcut simulation failed", {
        error: error.message,
      });
    }
  }

  async simulateRightClick() {
    try {
      if (Math.random() < 0.2) {
        // 20% chance of right click
        const viewport = (await this.page.viewport()) || {
          width: 1920,
          height: 1080,
        };
        const x = Math.random() * viewport.width;
        const y = Math.random() * viewport.height;

        await this.page.mouse.click(x, y, { button: "right" });
        await sleep(Math.random() * 500 + 200);

        // Dismiss context menu
        await this.page.keyboard.press("Escape");
      }
    } catch (error) {
      logger?.debug("Right click simulation failed", { error: error.message });
    }
  }

  async simulateTextSelection() {
    try {
      if (Math.random() < 0.3) {
        // 30% chance of text selection
        // Try to select some text on the page
        await this.page.evaluate(() => {
          const textNodes = [];
          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null,
            false
          );

          let node;
          while ((node = walker.nextNode())) {
            if (node.textContent.trim().length > 10) {
              textNodes.push(node);
            }
          }

          if (textNodes.length > 0) {
            const randomNode =
              textNodes[Math.floor(Math.random() * textNodes.length)];
            const range = document.createRange();
            const text = randomNode.textContent;
            const start = Math.floor((Math.random() * text.length) / 2);
            const end =
              start +
              Math.floor((Math.random() * (text.length - start)) / 2) +
              1;

            range.setStart(randomNode, start);
            range.setEnd(randomNode, Math.min(end, text.length));

            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);

            // Clear selection after a moment
            setTimeout(() => {
              selection.removeAllRanges();
            }, Math.random() * 1000 + 500);
          }
        });
      }
    } catch (error) {
      logger?.debug("Text selection simulation failed", {
        error: error.message,
      });
    }
  }

  async simulateTabNavigation() {
    try {
      if (Math.random() < 0.25) {
        // 25% chance of tab navigation
        const tabPresses = Math.floor(Math.random() * 3) + 1;
        for (let i = 0; i < tabPresses; i++) {
          await this.page.keyboard.press("Tab");
          await sleep(Math.random() * 300 + 100);
        }

        // Sometimes press Enter on focused element
        if (Math.random() < 0.1) {
          // 10% chance, but don't actually submit
          // Just a brief press down/up without real action
          await this.page.keyboard.down("Enter");
          await sleep(50);
          await this.page.keyboard.up("Enter");
        }
      }
    } catch (error) {
      logger?.debug("Tab navigation simulation failed", {
        error: error.message,
      });
    }
  }

  async simulateHumanGoogleSearch(searchQuery) {
    try {
      logger?.debug("Starting human-like Google search", { searchQuery });

      // Move mouse to a random position before starting (more visible movement)
      logger?.debug("Performing initial cursor movement");
      await this.cursor.moveTo({
        x: Math.random() * 300 + 100,
        y: Math.random() * 300 + 100,
      });
      await sleep(Math.random() * 200 + 100);

      // Add another realistic movement
      await this.cursor.moveTo({
        x: Math.random() * 400 + 200,
        y: Math.random() * 400 + 200,
      });
      await sleep(Math.random() * 200 + 100);

      // Enhanced entry simulation - NEVER use direct URL navigation
      const currentUrl = this.page.url();
      const isOnGoogle = currentUrl.includes("google.com");

      if (!isOnGoogle) {
        // Always navigate naturally to Google homepage first
        logger?.debug("Navigating to Google homepage with enhanced simulation");

        // Navigate to Google homepage
        await this.page.goto("https://www.google.com", {
          waitUntil: "domcontentloaded",
          timeout: 25000,
        });

        // Enhanced page load simulation
        await this.simulatePageLoadBehavior();

        // Handle cookies with human-like timing
        await this.handleCookieConsent();

        // Post-navigation human behavior
        await sleep(Math.random() * 800 + 400);
      } else {
        // Already on Google - simulate returning user behavior
        logger?.debug("Already on Google - simulating returning user");

        // Simulate natural page refresh or exploration
        if (Math.random() < 0.2) {
          // 20% chance to refresh page naturally
          await this.simulatePageRefresh();
        }

        // Brief exploration of current page
        await this.simulatePageExploration(1500);
      }

      // Find search box with multiple strategies - enhanced with user's specific selector
      const searchBoxSelectors = [
        "textarea#APjFqb", // Most specific, from user's example
        'textarea[name="q"]', // Standard name attribute
        "textarea.gLFyf", // Class name from user's example
        'div[jsname="gLFyf"] textarea', // Another specific selector
        "div.a4bIc textarea.gLFyf", // Full path from user's DOM example
        'textarea[title="Search"]', // Title attribute
        'textarea[aria-label="Search"]', // Aria label
      ];

      // Wait for search box to be available
      await this.page
        .waitForSelector(searchBoxSelectors.join(", "), {
          timeout: 10000,
          visible: true,
        })
        .catch(() => {
          logger?.warn("Search box selectors not found in initial wait");
        });

      let searchBox;
      for (const selector of searchBoxSelectors) {
        searchBox = await this.page.$(selector);
        if (searchBox) {
          logger?.debug("Found search box with selector", { selector });
          break;
        }
      }

      if (!searchBox) {
        // Try clicking on the search area first (some Google versions need this)
        const searchAreaSelectors = [
          'div[jsname="RNNXgb"]',
          'form[role="search"]',
          "div.RNNXgb",
          "div.a4bIc",
        ];

        for (const areaSelector of searchAreaSelectors) {
          const searchArea = await this.page.$(areaSelector);
          if (searchArea) {
            await this.cursor.click(areaSelector);
            await sleep(200);
            for (const selector of searchBoxSelectors) {
              searchBox = await this.page.$(selector);
              if (searchBox) break;
            }
            if (searchBox) break;
          }
        }
      }

      if (searchBox) {
        logger?.debug("Found search box, preparing to type query");

        // Use ghost cursor to realistically move to and click the search box
        let selector = null;
        for (const sel of searchBoxSelectors) {
          const element = await this.page.$(sel);
          if (element) {
            selector = sel;
            break;
          }
        }

        if (selector) {
          logger?.debug("Moving cursor to search box", { selector });
          // First move to the element, then click
          await this.cursor.move(selector);
          await sleep(Math.random() * 200 + 100);
          await this.cursor.click(selector);
        } else {
          logger?.warn("No search box selector found, using fallback click");
          await searchBox.click();
        }

        // Small pause after click
        await sleep(Math.random() * 300 + 100);

        // Enhanced human-like text clearing and typing
        logger?.debug("Clearing existing search text with human behavior");

        // First, select all existing text with varied methods
        const isMac = this.fingerprint.platform === "MacIntel";
        const ctrlKey = isMac ? "Meta" : "Control";

        // Reliable clearing method - always use triple-click to avoid cursor positioning issues
        await this.cursor.click(selector);
        await sleep(Math.random() * 100 + 50);

        // Triple-click to select all text (most reliable method)
        await this.page.click(selector, { clickCount: 3 });
        await sleep(Math.random() * 100 + 50);

        // Use Delete key to clear selection
        await this.page.keyboard.press("Delete");
        await sleep(Math.random() * 50 + 25);

        // Verify the field is empty with enhanced detection
        const currentValue = await this.page.evaluate((sel) => {
          const element = document.querySelector(sel);
          if (!element) return "";

          // Handle different input types
          if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
            return element.value || "";
          }

          // Handle contenteditable divs (some Google search implementations)
          if (element.contentEditable === "true") {
            return element.textContent || element.innerText || "";
          }

          return element.textContent || element.innerText || "";
        }, selector);

        // Enhanced manual clearing if needed
        if (currentValue && currentValue.trim()) {
          logger?.debug("Manual clearing required", {
            remainingText: currentValue.substring(0, 20),
          });

          // Human-like character deletion with variable speed
          for (let i = 0; i < currentValue.length + 5; i++) {
            await this.page.keyboard.press("Backspace");
            // Variable deletion speed (humans don't delete at constant speed)
            const deleteDelay =
              Math.random() < 0.3
                ? Math.random() * 50 + 20
                : Math.random() * 15 + 5;
            await sleep(deleteDelay);
          }

          // Final safety clear
          await this.page.keyboard.down(ctrlKey);
          await this.page.keyboard.press("KeyA");
          await this.page.keyboard.up(ctrlKey);
          await sleep(Math.random() * 50 + 25);
          await this.page.keyboard.press("Delete");
        }

        logger?.debug("Search box cleared successfully");

        // Human thinking pause before typing (varies by search complexity)
        const searchComplexity =
          searchQuery.length + (searchQuery.match(/[:"()]/g) || []).length;
        const thinkingTime = Math.random() * 500 + searchComplexity * 50 + 200;
        await sleep(thinkingTime);

        logger?.debug("Typing search query with enhanced human behavior", {
          query: searchQuery.substring(0, 50),
          complexity: searchComplexity,
        });

        // Enhanced human typing with realistic patterns
        await this.typeWithHumanBehavior(searchQuery, selector);

        // Sometimes make a typing correction (very human-like)
        if (Math.random() < 0.15 && searchQuery.length > 5) {
          // 15% chance for longer queries
          await sleep(Math.random() * 200 + 100);

          // Delete a few characters and retype them
          const deleteCount = Math.floor(Math.random() * 3) + 1;
          for (let i = 0; i < deleteCount; i++) {
            await this.page.keyboard.press("Backspace");
            await sleep(Math.random() * 80 + 40);
          }

          // Retype the corrected portion
          const correctionText = searchQuery.slice(-deleteCount);
          await this.typeWithHumanBehavior(correctionText, selector);
        }

        logger?.debug("Finished typing search query");
      } else {
        logger?.error(
          "Could not find search box on Google page - falling back to direct URL"
        );
        // Fallback to direct navigation
        const searchUrl = this.engine.searchUrl(searchQuery);
        await this.page.goto(searchUrl, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });
        return;
      }

      // Minimal pause before submitting
      await sleep(50);

      logger?.debug("Submitting search query");

      // Sometimes click the search button instead of pressing Enter
      if (Math.random() < 0.3) {
        const searchButtonSelectors = [
          'input[name="btnK"]',
          'button[name="btnK"]',
          'input[value="Google Search"]',
          'button[aria-label="Google Search"]',
        ];

        let searchButton = null;
        let buttonSelector = null;
        for (const selector of searchButtonSelectors) {
          searchButton = await this.page.$(selector);
          if (searchButton) {
            buttonSelector = selector;
            break;
          }
        }

        if (searchButton && buttonSelector) {
          try {
            const isVisible = await searchButton.isIntersectingViewport();
            if (isVisible) {
              logger?.debug("Clicking search button with ghost cursor");
              // Move to button first, then click
              await this.cursor.move(buttonSelector);
              await sleep(Math.random() * 100 + 50);
              await this.cursor.click(buttonSelector);
            } else {
              logger?.debug("Search button not visible, pressing Enter");
              await this.page.keyboard.press("Enter");
            }
          } catch (error) {
            logger?.debug("Error clicking search button, pressing Enter", {
              error: error.message,
            });
            await this.page.keyboard.press("Enter");
          }
        } else {
          logger?.debug("Search button not found, pressing Enter");
          await this.page.keyboard.press("Enter");
        }
      } else {
        logger?.debug("Pressing Enter to search");
        await this.page.keyboard.press("Enter");
      }

      // Wait for navigation to complete - fast timeout
      try {
        const startUrl = this.page.url();
        await Promise.race([
          this.page.waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: 5000,
          }),
          // Also wait for URL change as backup
          this.page.waitForFunction(
            (currentUrl) => window.location.href !== currentUrl,
            { timeout: 5000 },
            startUrl
          ),
        ]);

        const newUrl = this.page.url();
        logger?.debug("Navigation completed, URL changed to", {
          url: newUrl,
        });

        // Verify the search was performed
        if (!newUrl.includes("/search") && !newUrl.includes("&q=")) {
          logger?.warn("Search navigation failed, using direct URL");
          const searchUrl = this.engine.searchUrl(searchQuery);
          await this.page.goto(searchUrl, {
            waitUntil: "domcontentloaded",
            timeout: 15000,
          });
        }
      } catch (error) {
        logger?.debug(
          "Navigation wait completed with timeout, using direct URL"
        );
        // Fallback to direct navigation
        const searchUrl = this.engine.searchUrl(searchQuery);
        await this.page.goto(searchUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
      }

      // No delay - continue immediately

      // Skip cookie consent check on search results page
      const resultPageUrl = this.page.url();
      if (
        !resultPageUrl.includes("/search?") &&
        !resultPageUrl.includes("&q=")
      ) {
        await this.handleCookieConsent();
      }

      logger?.debug("Human-like Google search completed successfully");
    } catch (error) {
      logger?.error("Human search simulation error", {
        error: error.message,
        stack: error.stack,
        searchQuery,
      });
      // Fallback to direct URL navigation
      try {
        const searchUrl = this.engine.searchUrl(searchQuery);
        logger?.warn("Falling back to direct URL navigation", { searchUrl });
        await this.page.goto(searchUrl, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });
      } catch (fallbackError) {
        logger?.error("Fallback navigation also failed", {
          error: fallbackError.message,
        });
      }
    }
  }

  async search(dork, retryCount = 0) {
    const results = [];
    const startTime = Date.now();
    const maxRetries = 2; // Maximum proxy switch retries

    // Store current dork for proxy switches
    this.currentDork = dork;

    try {
      logger?.info("Starting search", {
        dork: dork.substring(0, 100),
        engine: this.engine.name,
        isGoogleEngine: this.isGoogleEngine,
        retryCount,
      });

      console.log(
        chalk.cyan(
          `🔍 ${this.engine.name}: ${dork.substring(0, 60)}${
            dork.length > 60 ? "..." : ""
          }`
        )
      );

      // Enhanced fingerprint variation for each search (critical for stealth)
      if (retryCount > 0 || this.captchaCount > 0) {
        // Generate completely new fingerprint for retries or after CAPTCHAs
        this.fingerprint = generateRandomFingerprint();
        this.currentViewport = {
          width: this.fingerprint.screen.width,
          height: this.fingerprint.screen.height,
          deviceScaleFactor: this.fingerprint.screen.deviceScaleFactor,
        };
        await this.applyFingerprint();
        logger?.info("Applied new fingerprint for stealth", {
          retryCount,
          captchaCount: this.captchaCount,
        });
      }

      // CRITICAL: Enhanced human simulation BEFORE every search
      const isFirstVisit = retryCount === 0 && this.captchaCount === 0;
      logger?.debug("Starting enhanced human simulation", {
        isFirstVisit,
        retryCount,
      });
      await this.enhancedHumanSimulation(dork, isFirstVisit);

      // Check if we should use direct URL mode (after too many CAPTCHAs)
      const useDirectMode = this.captchaCount > 3; // Increased threshold

      if (useDirectMode) {
        console.log(chalk.yellow("[!] Using direct URL mode due to CAPTCHAs"));
        const searchUrl = this.engine.searchUrl(dork);
        logger?.debug("Direct navigation to search URL", { searchUrl });

        await this.page.goto(searchUrl, {
          waitUntil: "networkidle2",
          timeout: 60000,
        });

        // Handle cookie consent
        await this.handleCookieConsent();
      } else if (this.isGoogleEngine) {
        logger?.debug("Using human-like Google search behavior", { dork });
        await this.simulateHumanGoogleSearch(dork);
      } else {
        // For other engines, use direct navigation
        const searchUrl = this.engine.searchUrl(dork);
        logger?.debug("Direct navigation to search URL", { searchUrl });

        await this.page.goto(searchUrl, {
          waitUntil: "networkidle2",
          timeout: 60000,
        });

        // Handle cookie consent for non-Google engines
        await this.handleCookieConsent();
      }

      // Minimal delay - just enough for DOM to be ready
      await sleep(100);

      // Check current URL to see if search was performed
      const currentUrl = this.page.url();
      logger?.debug("Current URL after search", { url: currentUrl });

      // If we're still on the homepage, the search didn't work
      if (
        currentUrl.includes("google.com") &&
        !currentUrl.includes("/search")
      ) {
        console.log(chalk.yellow("[!] Search not performed, retrying..."));
        // Try direct navigation as fallback
        const searchUrl = this.engine.searchUrl(dork);
        await this.page.goto(searchUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
      }

      // Check if we're blocked and handle CAPTCHA manually
      let isBlocked = false;
      try {
        isBlocked = await this.isBlocked();
      } catch (error) {
        logger?.warn("Error checking if blocked, assuming not blocked", {
          error: error.message,
        });
        isBlocked = false;
      }

      if (isBlocked) {
        logger?.warn("CAPTCHA/blocking detected", { dork });
        this.captchaCount++;
        console.log(chalk.yellow(`[!] CAPTCHA count: ${this.captchaCount}`));

        const resolved = await this.handleCaptchaManually(dork);

        // Handle proxy switch success - restart search with fresh CAPTCHA detection
        if (resolved === "proxy_switched_success") {
          console.log(
            chalk.blue(
              "🔄 Proxy switched successfully - restarting search with fresh CAPTCHA detection"
            )
          );
          logger?.info("Restarting search after successful proxy switch", {
            dork: dork.substring(0, 100),
          });
          // Don't increment retryCount for successful proxy switches
          return await this.search(dork, 0);
        }

        // Handle proxy switch retry
        if (resolved === "proxy_switched_retry") {
          if (retryCount < maxRetries) {
            logger?.info("Retrying search with new proxy", {
              dork: dork.substring(0, 100),
              retryCount: retryCount + 1,
              maxRetries,
            });
            console.log(
              chalk.blue(
                `🔄 Retrying search with new proxy (attempt ${retryCount + 1}/${
                  maxRetries + 1
                })`
              )
            );
            return await this.search(dork, retryCount + 1);
          } else {
            logger?.warn("Maximum proxy switch retries reached", {
              dork: dork.substring(0, 100),
              maxRetries,
            });
            console.log(
              chalk.red(
                "❌ Maximum proxy switch retries reached - skipping dork"
              )
            );
            return [];
          }
        }

        if (!resolved) {
          logger?.info("CAPTCHA resolution failed, skipping dork", { dork });
          return [];
        }
      }

      // Skip all unnecessary waiting - go straight to results
      logger?.debug("Skipping wait times for faster processing");

      // Skip human simulation completely for maximum speed
      if (Math.random() > 0.95) {
        // Only 5% chance
        await this.simulateHumanBehavior();
      }

      // Try to wait for specific result elements to appear
      logger?.debug("Waiting for search results to appear");
      const hasResults = await this.waitForSearchResults();
      if (!hasResults) {
        logger?.info("No results found", { dork });
        console.log(chalk.yellow(`⏭️  No results found`));
        return [];
      }

      // Extract search results with enhanced error handling and logging
      logger?.debug("Extracting search results from page");

      const searchResults = await this.page.evaluate((engine) => {
        const items = [];

        for (const selector of engine.resultSelectors) {
          const elements = document.querySelectorAll(selector);

          elements.forEach((el, index) => {
            try {
              const titleEl = el.querySelector(engine.titleSelector);
              const linkEl = el.querySelector(engine.linkSelector);
              const descEl = el.querySelector(engine.descSelector);

              if (titleEl && linkEl) {
                const title = titleEl.innerText || titleEl.textContent || "";
                let url = linkEl.href || linkEl.getAttribute("href") || "";

                // Clean up URL redirects - handle both Google redirect formats
                if (url.includes("/url?")) {
                  try {
                    // Handle relative URLs by making them absolute
                    const baseUrl = window.location.origin;
                    const fullUrl = url.startsWith("/") ? baseUrl + url : url;
                    const urlObj = new URL(fullUrl);

                    // Try different parameter names Google uses for the actual URL
                    const targetUrl =
                      urlObj.searchParams.get("url") ||
                      urlObj.searchParams.get("q") ||
                      urlObj.searchParams.get("u") ||
                      url;

                    // Decode any URL encoding in the extracted URL
                    url = decodeURIComponent(targetUrl);

                    console.log(
                      `🔗 Extracted URL: ${url.substring(0, 100)}...`
                    );
                  } catch (e) {
                    console.log(
                      `⚠️ URL parsing failed for: ${url.substring(0, 50)}...`
                    );
                    // Keep original URL if parsing fails
                  }
                }

                const description = descEl
                  ? descEl.innerText || descEl.textContent || ""
                  : "No description available";

                if (title.trim() && url.trim() && url.startsWith("http")) {
                  items.push({
                    title: title.trim(),
                    url: url.trim(),
                    description: description.trim().substring(0, 300),
                  });
                }
              }
            } catch (err) {
              // Silently continue with next element
            }
          });

          // Don't break - continue collecting from all selectors
        }

        return items;
      }, this.engine);

      if (searchResults.length === 0) {
        logger?.info("No results extracted from page", { dork });
        console.log(chalk.yellow(`⏭️  No valid results extracted`));
        return [];
      }

      const finalResults = searchResults.slice(0, this.options.maxResults);
      results.push(...finalResults);

      const searchTime = Date.now() - startTime;
      logger?.info("Search completed successfully", {
        dork: dork.substring(0, 100),
        engine: this.engine.name,
        resultCount: results.length,
        totalFound: searchResults.length,
        searchTimeMs: searchTime,
      });

      console.log(
        chalk.green(`✅ Found ${results.length} results (${searchTime}ms)`)
      );

      // PERFORMANCE OPTIMIZATION: Skip delays if we successfully got results
      // This implements the user's request to not wait/delay after successful scraping
      logger?.debug(
        "Skipping post-scrape delays due to successful result extraction"
      );
    } catch (error) {
      if (error.message.includes("proxy_switched")) {
        logger?.info("Proxy switch successful, restarting search.", {
          signal: error.message,
        });
        console.log(
          chalk.green("✅ Proxy switch successful! Restarting search...")
        );
        return this.search(dork, retryCount + 1);
      }

      const searchTime = Date.now() - startTime;
      logger?.error("Search failed", {
        dork: dork.substring(0, 100),
        engine: this.engine.name,
        error: error.message,
        stack: error.stack,
        searchTimeMs: searchTime,
      });

      console.error(chalk.red(`❌ Search failed: ${error.message}`));

      if (error.name === "TimeoutError" || error.message.includes("timeout")) {
        console.log(
          chalk.yellow(" Navigation timed out. Attempting proxy switch...")
        );
        // Handle navigation timeout with proxy switch
        if (this.currentProxy) {
          logger?.info("Navigation timeout detected, switching proxy", {
            currentProxy: `${this.currentProxy.host}:${this.currentProxy.port}`,
          });
          const proxySignal = await this.handleAutomatedQueriesWithProxySwitch(
            dork,
            retryCount
          );
          throw new Error(proxySignal);
        } else if (this.options.useProxyOnCaptcha) {
          this.handleAutomatedQueriesWithProxySwitch(dork, 0).catch(() => {});
          return this.search(dork, retryCount + 1);
        }
      } else if (
        error.message.includes("ERR_SOCKS_CONNECTION_FAILED") ||
        error.message.includes("ERR_PROXY_CONNECTION_FAILED") ||
        error.message.includes("net::ERR_SOCKS_CONNECTION_FAILED") ||
        error.message.includes("net::ERR_PROXY_CONNECTION_FAILED")
      ) {
        console.log(
          chalk.yellow(
            " SOCKS/Proxy connection failed. Attempting proxy switch..."
          )
        );
        // Handle SOCKS connection failure with proxy switch
        if (this.currentProxy) {
          logger?.info("SOCKS/Proxy connection failed, switching proxy", {
            currentProxy: `${this.currentProxy.host}:${this.currentProxy.port}`,
            error: error.message,
          });
          const proxySignal = await this.handleAutomatedQueriesWithProxySwitch(
            dork,
            retryCount
          );
          throw new Error(proxySignal);
        }
      }

      // Handle browser/page closure errors
      if (
        error.message.includes("Target closed") ||
        error.message.includes("Session closed") ||
        error.message.includes("Protocol error")
      ) {
        logger?.warn("Browser connection lost, attempting to reinitialize", {
          dork: dork.substring(0, 100),
          error: error.message,
        });

        console.log(
          chalk.yellow(
            "🔄 Browser connection lost. Reinitializing for next dork..."
          )
        );

        try {
          // Don't reinitialize immediately - let the main loop handle it
          // This prevents hanging on the current dork
          this.page = null; // Mark page as invalid
        } catch (reinitError) {
          logger?.error("Failed to handle browser closure", {
            error: reinitError.message,
          });
        }
      }

      return [];
    }

    return results;
  }

  async checkForAutomatedQueries(frame) {
    if (!frame) return false;

    return frame.evaluate(() => {
      const textContent = document.body.textContent || "";
      const automatedQueriesKeywords = [
        "automated queries",
        "can't process your request",
        "protect our users",
        "Your computer or network may be sending",
      ];

      return automatedQueriesKeywords.some((keyword) =>
        textContent.includes(keyword)
      );
    });
  }
}

// ... rest of the code ...

// --- Main Execution with Interactive Menu ---
async function main() {
  // Ensure logger is initialized
  if (!logger) {
    logger = await createLogger();
  }

  logger?.info("Dorker application starting", {
    version: "2.2.0-optimized",
    nodeVersion: process.version,
    platform: process.platform,
  });

  // Check if running with command line args (backward compatibility)
  const program = new Command();
  program
    .version("2.2.0-captcha-assist")
    .description(
      chalk.blueBright(
        "Advanced Multi-Engine Dorker with Manual CAPTCHA Assistance"
      )
    )
    .option("-f, --file <path>", "Path to the dork file")
    .option("-e, --engine <engine>", "Search engine (google, bing, duckduckgo)")
    .option("-m, --max-results <number>", "Maximum results per dork")
    .option("-d, --delay <milliseconds>", "Delay between requests in ms")
    .option("--no-headless", "Show the browser while scraping")
    .option(
      "--no-auto-solve",
      "Disable automatic CAPTCHA solving (audio and image)"
    )
    .option("--use-proxy-on-captcha", "Use proxy when CAPTCHA is detected")
    .option("--interactive", "Force interactive mode")
    .parse(process.argv);

  const cliOptions = program.opts();
  let options;

  // Use interactive mode if no significant args provided or explicitly requested
  if (Object.keys(cliOptions).length <= 1 || cliOptions.interactive) {
    await showWelcome();

    const engine = await getSearchEngineChoice();
    const settings = await getSettings();

    options = {
      engine,
      file: "dork.txt",
      maxResults: settings.maxResults,
      delay: settings.delay,
      headless: settings.headless,
      output: settings.outputFile,
      autoSolve: settings.autoSolve,
      useProxyOnCaptcha: settings.useProxyOnCaptcha,
    };

    console.log(
      chalk.green("\n✅ Configuration complete! Starting dorker...\n")
    );
  } else {
    // Use CLI mode for backward compatibility
    options = {
      engine: cliOptions.engine || "google",
      file: cliOptions.file || "dork.txt",
      maxResults: parseInt(cliOptions.maxResults) || 10,
      delay: parseInt(cliOptions.delay) || 3000,
      headless: cliOptions.headless !== false,
      output: cliOptions.output,
      autoSolve: cliOptions.autoSolve !== false,
      useProxyOnCaptcha: cliOptions.useProxyOnCaptcha === true,
    };
  }

  // Validate search engine
  if (!SEARCH_ENGINES[options.engine]) {
    console.error(chalk.red(`[!] Invalid search engine: ${options.engine}`));
    console.log(
      chalk.yellow(
        `Available engines: ${Object.keys(SEARCH_ENGINES).join(", ")}`
      )
    );
    process.exit(1);
  }

  console.log(chalk.cyan.bold("--- Dorker Status ---"));
  console.log(
    `🔍 Search Engine: ${chalk.yellow(SEARCH_ENGINES[options.engine].name)}`
  );
  console.log(`📁 Dork file: ${chalk.yellow(options.file)}`);
  console.log(`📊 Max results per dork: ${chalk.yellow(options.maxResults)}`);
  console.log(`⏱️  Delay between dorks: ${chalk.yellow(options.delay)}ms`);
  console.log(
    `👁️  Headless mode: ${
      options.headless ? chalk.green("Enabled") : chalk.red("Disabled")
    }`
  );
  console.log(
    `🤖 CAPTCHA handling: ${chalk.blue("Manual assistance enabled")}`
  );
  console.log(
    `🤖 Auto-solving: ${
      options.autoSolve ? chalk.green("Enabled") : chalk.red("Disabled")
    }`
  );
  console.log(
    `🌐 Proxy on CAPTCHA: ${
      options.useProxyOnCaptcha ? chalk.green("Enabled") : chalk.red("Disabled")
    }`
  );
  if (options.output) {
    console.log(`💾 Output file: ${chalk.yellow(options.output)}`);
  }
  console.log(chalk.cyan.bold("---------------------\n"));

  const dorks = await loadDorks(options.file);
  if (!dorks || dorks.length === 0) return;

  const dorker = new MultiEngineDorker(options);
  await dorker.initialize();

  const allResults = {};
  let totalLinksFound = 0;

  // Create output file path if specified
  const outputFilePath = options.output ? path.resolve(options.output) : null;

  const progressBar = new cliProgress.SingleBar({
    format: `Dorking | ${chalk.cyan(
      "{bar}"
    )} | {percentage}% || {value}/{total} Dorks | ${chalk.green(
      "Links: {links}"
    )}`,
    barCompleteChar: "\u2588",
    barIncompleteChar: "\u2591",
    hideCursor: true,
  });

  progressBar.start(dorks.length, 0, { links: 0 });

  for (let i = 0; i < dorks.length; i++) {
    const dork = dorks[i];

    // Browser Health Check
    if (
      !dorker.browser?.isConnected() ||
      !dorker.page ||
      dorker.page.isClosed()
    ) {
      logger?.warn("Browser seems to have crashed. Re-initializing.", {
        dorkIndex: i,
      });
      console.log(
        chalk.yellow("\n🔄 Browser connection lost. Attempting to recover...")
      );
      try {
        await dorker.initialize();
        console.log(chalk.green("✅ Browser recovered successfully."));
      } catch (reinitError) {
        logger?.error("Fatal: Failed to re-initialize browser. Stopping.", {
          error: reinitError.message,
        });
        console.log(
          chalk.red("❌ Failed to recover browser session. Exiting.")
        );
        break; // Exit the dorking loop
      }
    }

    logger?.info("Processing dork", {
      dork: dork.substring(0, 100),
      dorkIndex: i + 1,
      totalDorks: dorks.length,
    });

    const results = await dorker.search(dork);

    if (results && results.length > 0) {
      allResults[dork] = results;
      totalLinksFound += results.length;

      logger?.info("Dork completed with results", {
        dork: dork.substring(0, 100),
        resultCount: results.length,
        totalLinks: totalLinksFound,
      });

      // Save results immediately after each successful dork
      if (outputFilePath) {
        await appendDorkResults(dork, results, outputFilePath, allResults);
        console.log(
          chalk.green(`[💾] Results saved to ${path.basename(outputFilePath)}`)
        );
      }

      progressBar.increment(1, { links: totalLinksFound });

      // Check if browser is still alive before cleaning session
      if (dorker.page && !dorker.page.isClosed()) {
        await dorker.cleanSession();
      } else {
        logger?.warn(
          "Browser closed after getting results, reinitializing for next dork"
        );
        if (i < dorks.length - 1) {
          try {
            await dorker.initialize();
          } catch (reinitError) {
            logger?.error("Failed to reinitialize browser", {
              error: reinitError.message,
            });
            console.log(
              chalk.red("❌ Failed to reinitialize browser. Stopping.")
            );
            break;
          }
        }
      }

      // Minimal delay after successful scraping
      await sleep(Math.min(options.delay, 300) + randomDelay(50, 150));
    } else {
      logger?.info("Dork completed with no results", {
        dork: dork.substring(0, 100),
      });

      progressBar.increment(1, { links: totalLinksFound });

      // Check if browser is still alive before cleaning session
      if (dorker.page && !dorker.page.isClosed()) {
        await dorker.cleanSession();
      } else {
        logger?.warn("Browser closed, reinitializing for next dork");
        if (i < dorks.length - 1) {
          try {
            await dorker.initialize();
          } catch (reinitError) {
            logger?.error("Failed to reinitialize browser", {
              error: reinitError.message,
            });
            console.log(
              chalk.red("❌ Failed to reinitialize browser. Stopping.")
            );
            break;
          }
        }
      }

      await sleep(Math.min(options.delay, 500) + randomDelay(50, 200));
    }
  }

  progressBar.stop();
  await dorker.close();

  const finalSummary = {
    totalDorks: dorks.length,
    successfulDorks: Object.keys(allResults).length,
    totalResults: Object.values(allResults).reduce(
      (sum, results) => sum + results.length,
      0
    ),
    engine: options.engine,
    timestamp: new Date().toISOString(),
  };

  logger?.info("Dorking session completed", finalSummary);

  console.log(chalk.magenta.bold("\n--- Dorking Complete ---"));

  let foundCount = 0;
  for (const dork in allResults) {
    foundCount++;
    logger?.debug("Displaying results for dork", {
      dork: dork.substring(0, 100),
      resultCount: allResults[dork].length,
    });

    console.log(
      `\n[+] ${chalk.green(
        allResults[dork].length
      )} results for dork: ${chalk.cyan(dork)}`
    );
    allResults[dork].forEach((res, index) => {
      console.log(`  ${chalk.yellow(index + 1)}. ${chalk.blue(res.title)}`);
      console.log(`     ${chalk.green(res.url)}`);
      console.log(`     ${chalk.gray(res.description.substring(0, 120))}...`);
    });
  }

  console.log(chalk.magenta.bold("\n--- Summary ---"));
  console.log(
    `[+] Found results for ${chalk.green(foundCount)} of ${chalk.yellow(
      dorks.length
    )} dorks using ${chalk.cyan(SEARCH_ENGINES[options.engine].name)}.`
  );

  logger?.info("Final results summary", {
    dorksWithResults: foundCount,
    totalDorksProcessed: dorks.length,
    successRate: `${((foundCount / dorks.length) * 100).toFixed(1)}%`,
    totalLinksFound: finalSummary.totalResults,
    engine: SEARCH_ENGINES[options.engine].name,
  });

  if (options.output) {
    await saveResults(allResults, options.output);
    logger?.info("Results saved to output file", {
      outputFile: options.output,
      resultCount: finalSummary.totalResults,
    });
  }

  // Final cleanup
  if (dorker) {
    await dorker.close();
  }
}

main().catch((err) => {
  if (logger) {
    logger.error("Application crashed", {
      error: err.message,
      stack: err.stack,
    });
  }
  console.error(chalk.red("[FATAL ERROR]"), err);
  process.exit(1);
});
