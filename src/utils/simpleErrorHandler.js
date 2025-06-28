import chalk from "chalk";

/**
 * Simple error handler to display user-friendly error messages
 * @param {Error} error - The error object
 * @param {string} operation - Description of what operation failed
 * @param {Object} logger - Logger instance (optional)
 * @returns {boolean} Whether to continue execution
 */
export function handleError(error, operation, logger = null) {
  // Log to file if logger available
  if (logger) {
    logger.error(`Error during ${operation}`, {
      error: error.message,
      stack: error.stack,
      operation,
    });
  }

  // Display user-friendly error message
  console.error(chalk.red(`\n❌ Error during ${operation}`));
  console.error(chalk.gray(`   ${error.message}`));

  // Provide helpful suggestions based on error type
  const suggestion = getSuggestion(error.message);
  if (suggestion) {
    console.error(chalk.yellow(`   💡 ${suggestion}`));
  }

  // Return whether to continue (true) or stop (false)
  return !isFatalError(error);
}

/**
 * Get helpful suggestion based on error message
 */
function getSuggestion(errorMessage) {
  if (errorMessage.includes("ENOENT")) {
    return "Check if the file exists and the path is correct";
  }
  if (errorMessage.includes("EACCES")) {
    return "Check file permissions";
  }
  if (errorMessage.includes("timeout") || errorMessage.includes("Timeout")) {
    return "Try increasing the timeout or check your internet connection";
  }
  if (errorMessage.includes("proxy") || errorMessage.includes("Proxy")) {
    return "Check proxy settings or try without proxy";
  }
  if (errorMessage.includes("Cannot read properties")) {
    return "There may be a configuration issue - check your settings";
  }
  if (errorMessage.includes("navigation")) {
    return "The browser may have trouble loading the page - try headless mode";
  }
  return null;
}

/**
 * Determine if error is fatal and should stop execution
 */
function isFatalError(error) {
  const fatalPatterns = [
    "Cannot find module",
    "SyntaxError",
    "FATAL",
    "critical error",
  ];

  return fatalPatterns.some((pattern) =>
    error.message.toLowerCase().includes(pattern.toLowerCase())
  );
}

/**
 * Wrap a function with basic error handling
 */
export function withErrorHandling(fn, operation) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      const shouldContinue = handleError(error, operation);
      if (!shouldContinue) {
        throw error;
      }
      return null;
    }
  };
}

/**
 * Initialize global error handlers
 */
export function initializeErrorHandlers() {
  // Handle uncaught exceptions
  process.on("uncaughtException", (error) => {
    console.error(chalk.red("\n💀 Uncaught Exception:"));
    console.error(chalk.gray(error.message));
    console.error(chalk.yellow("   The application will now exit"));
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on("unhandledRejection", (reason) => {
    console.error(chalk.red("\n💀 Unhandled Promise Rejection:"));
    console.error(chalk.gray(String(reason)));
    console.error(chalk.yellow("   The application will now exit"));
    process.exit(1);
  });
}
