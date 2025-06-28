#!/usr/bin/env node

import chalk from "chalk";
import { createLogger } from "./utils/logger.js";
import {
  displayBanner,
  getConfiguration,
  askSaveUrls,
  displayProgress,
  displayResults,
  displayFinalSummary,
  createSpinner,
  displaySuccess,
  displayError,
  displayWarning,
} from "./ui/cli.js";
import {
  loadDorks,
  saveResults,
  appendDorkResults,
  saveUrlsToFile,
} from "./utils/fileOperations.js";
import MultiEngineDorker from "./dorker/MultiEngineDorker.js";

/**
 * Main application entry point
 */
async function main() {
  let logger = null;
  let dorker = null;
  const startTime = Date.now();

  try {
    // Display banner
    displayBanner();

    // Get user configuration
    const config = await getConfiguration();

    // Create logger with log clearing enabled by default
    const logSpinner = createSpinner("Initializing logging system...", "cyan");
    logSpinner.start();

    logger = await createLogger(true); // Always clear logs on startup
    logger.info("Starting Dorker application", { config });

    logSpinner.succeed(chalk.cyan("Logging system initialized"));

    // Load dorks from file
    const dorkSpinner = createSpinner("Loading dorks from file...", "blue");
    dorkSpinner.start();

    const dorks = await loadDorks(config.dorkFile, logger);
    if (dorks.length === 0) {
      dorkSpinner.fail();
      displayError("No dorks found in file", null);
      process.exit(1);
    }

    dorkSpinner.succeed(chalk.blue(`Loaded ${dorks.length} dorks from file`));

    // Initialize dorker
    const initSpinner = createSpinner(
      "Initializing browser and security systems...",
      "magenta"
    );
    initSpinner.start();

    dorker = new MultiEngineDorker(config, logger);
    await dorker.initialize();

    initSpinner.succeed(chalk.magenta("Browser and security systems ready"));

    // Results storage
    const allResults = {};

    displaySuccess(`Starting dorking process with ${dorks.length} dorks`);

    // Process each dork
    for (let i = 0; i < dorks.length; i++) {
      const dork = dorks[i];

      try {
        // Display progress
        displayProgress(i + 1, dorks.length, dork);

        // Create search spinner
        const searchSpinner = createSpinner(
          `Searching: ${dork.substring(0, 50)}...`,
          "green"
        );
        searchSpinner.start();

        // Perform search
        const results = await dorker.performSearch(dork, config.resultCount);

        if (results && results.length > 0) {
          searchSpinner.succeed(chalk.green(`Found ${results.length} results`));
        } else {
          searchSpinner.warn(chalk.yellow("No results found"));
        }

        // Display results
        displayResults(results, dork);

        // Store results
        allResults[dork] = results;

        // Append to output file immediately if configured
        if (config.outputFile) {
          await appendDorkResults(
            dork,
            results,
            config.outputFile,
            allResults,
            logger
          );
        }

        // Delay between searches (except for last dork)
        if (i < dorks.length - 1) {
          const delaySpinner = createSpinner(
            `Waiting ${config.delay}s before next search...`,
            "yellow"
          );
          delaySpinner.start();

          await dorker.delayBetweenSearches();

          delaySpinner.succeed(chalk.yellow("Delay completed"));
        }
      } catch (error) {
        logger.error("Error processing dork", {
          dork: dork.substring(0, 50),
          error: error.message,
          index: i + 1,
        });

        displayError(
          `Failed to process dork: ${dork.substring(0, 60)}...`,
          error
        );

        // Store empty results for failed dork
        allResults[dork] = [];
      }
    }

    // Save final results
    if (config.outputFile) {
      const saveSpinner = createSpinner("Saving final results...", "cyan");
      saveSpinner.start();

      await saveResults(allResults, config.outputFile, logger);

      saveSpinner.succeed(chalk.cyan(`Results saved to ${config.outputFile}`));
    }

    // Display final summary
    displayFinalSummary(allResults, startTime);

    // Ask if user wants to save URLs to result.txt
    const shouldSaveUrls = await askSaveUrls(allResults);
    if (shouldSaveUrls) {
      const urlSpinner = createSpinner("Saving URLs to result.txt...", "blue");
      urlSpinner.start();

      await saveUrlsToFile(allResults, "result.txt", logger);

      urlSpinner.succeed(chalk.blue("URLs saved to result.txt"));
    }

    displaySuccess("Dorking process completed successfully!");
  } catch (error) {
    if (logger) {
      logger.error("Fatal error in main process", {
        error: error.message,
        stack: error.stack,
      });
    }
    displayError("Fatal application error", error);
    process.exit(1);
  } finally {
    // Cleanup resources
    if (dorker) {
      const cleanupSpinner = createSpinner("Cleaning up resources...", "gray");
      cleanupSpinner.start();

      await dorker.cleanup();

      cleanupSpinner.succeed(chalk.gray("Cleanup completed"));
    }

    if (logger) {
      logger.info("Application shutdown completed");
    }
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  displayWarning("Received interrupt signal. Shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  displayWarning("Received termination signal. Shutting down gracefully...");
  process.exit(0);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  displayError("Uncaught Exception", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, _promise) => {
  displayError("Unhandled Promise Rejection", new Error(reason));
  process.exit(1);
});

// Start the application
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    displayError("Application failed to start", error);
    process.exit(1);
  });
}

export { main };
