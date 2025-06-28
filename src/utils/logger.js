import winston from "winston";
import chalk from "chalk";
import path from "path";
import fs from "fs/promises";
import { CONSOLE_LOG_CACHE_CONFIG } from "../config/index.js";

// Console log deduplication cache
const CONSOLE_LOG_CACHE = new Set();

// Enhanced console logging with deduplication
// Global flag to prevent console output when spinners are active
let consoleSuppressed = false;

const logWithDedup = (
  level,
  message,
  color = null,
  logger = null,
  forceConsole = false
) => {
  const logKey = `${level}:${message}`;
  if (CONSOLE_LOG_CACHE.has(logKey)) {
    return; // Skip duplicate log
  }

  CONSOLE_LOG_CACHE.add(logKey);

  // Clean cache if it gets too large
  if (CONSOLE_LOG_CACHE.size > CONSOLE_LOG_CACHE_CONFIG.maxSize) {
    const firstItem = CONSOLE_LOG_CACHE.values().next().value;
    CONSOLE_LOG_CACHE.delete(firstItem);
  }

  // Always use logger with proper level structure
  if (logger) {
    // Map custom levels to winston levels
    const levelMap = {
      success: "info",
      warning: "warn",
      debug: "debug",
      info: "info",
      error: "error",
      warn: "warn",
    };

    const mappedLevel = levelMap[level] || "info";
    if (typeof logger[mappedLevel] === "function") {
      logger[mappedLevel](message);
    } else {
      // Fallback to info if level doesn't exist
      logger.info(message);
    }
  }

  // Only show to console if not suppressed OR if forced
  if (!consoleSuppressed || forceConsole) {
    if (color) {
      console.log(color(`[${level.toUpperCase()}] ${message}`));
    } else {
      console.log(`[${level.toUpperCase()}] ${message}`);
    }
  }
};

// Function to clear previous log files
const clearPreviousLogs = async (logsDir) => {
  try {
    const logFiles = [
      "debug.log",
      "error.log",
      "combined.log",
      "exceptions.log",
      "rejections.log",
    ];

    for (const logFile of logFiles) {
      const filePath = path.join(logsDir, logFile);
      try {
        await fs.access(filePath);
        await fs.writeFile(filePath, ""); // Clear the file
      } catch (error) {
        // File doesn't exist, which is fine
      }
    }
  } catch (error) {
    console.warn(
      chalk.yellow(`Warning: Could not clear previous logs: ${error.message}`)
    );
  }
};

// Create logger instance
const createLogger = async (clearLogs = true) => {
  try {
    // Create logs directory
    const logsDir = path.join(process.cwd(), "logs");
    await fs.mkdir(logsDir, { recursive: true });

    // Clear previous logs if requested
    if (clearLogs) {
      await clearPreviousLogs(logsDir);
    }

    // Add startup log entry
    const startupTime = new Date().toISOString();
    const startupMessage = `DORKER SESSION STARTED - ${startupTime}`;

    // Winston logger configuration
    const logger = winston.createLogger({
      level: "debug",
      format: winston.format.combine(
        winston.format.timestamp({
          format: "YYYY-MM-DD HH:mm:ss",
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.printf(
          ({ level, message, timestamp, service, ...meta }) => {
            // Ensure level comes first in JSON
            const logObject = {
              level,
              message,
              timestamp,
              service: service || "dorker",
              ...meta,
            };
            return JSON.stringify(logObject);
          }
        )
      ),
      defaultMeta: { service: "dorker" },
      transports: [
        // Debug file - all logs
        new winston.transports.File({
          filename: path.join(logsDir, "debug.log"),
          level: "debug",
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 3,
          tailable: true,
        }),
        // Error file - only errors
        new winston.transports.File({
          filename: path.join(logsDir, "error.log"),
          level: "error",
          maxsize: 5 * 1024 * 1024, // 5MB
          maxFiles: 3,
          tailable: true,
        }),
        // Combined file - info and above
        new winston.transports.File({
          filename: path.join(logsDir, "combined.log"),
          level: "info",
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 3,
          tailable: true,
        }),
      ],
    });

    // Add console transport in development
    if (process.env.NODE_ENV !== "production") {
      logger.add(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
          level: "error", // Only show errors in console to reduce noise
        })
      );
    }

    // Global error handlers
    logger.exceptions.handle(
      new winston.transports.File({
        filename: path.join(logsDir, "exceptions.log"),
      })
    );

    logger.rejections.handle(
      new winston.transports.File({
        filename: path.join(logsDir, "rejections.log"),
      })
    );

    // Log the startup message
    logger.info(startupMessage);

    return logger;
  } catch (error) {
    console.error(chalk.red("Failed to create logger:", error.message));
    // Return a console-only logger as fallback
    return console;
  }
};

// Console control functions
const suppressConsoleOutput = () => {
  consoleSuppressed = true;
};

const resumeConsoleOutput = () => {
  consoleSuppressed = false;
};

const isConsoleSuppressed = () => {
  return consoleSuppressed;
};

export {
  createLogger,
  logWithDedup,
  CONSOLE_LOG_CACHE,
  clearPreviousLogs,
  suppressConsoleOutput,
  resumeConsoleOutput,
  isConsoleSuppressed,
};
