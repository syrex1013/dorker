#!/usr/bin/env node

import chalk from "chalk";
import { createLogger } from "./utils/logger.js";
import {
  displayBanner,
  getConfiguration,
  askSaveUrls,
  displayFinalSummary,
  createSpinner,
  displayError,
} from "./ui/cli.js";
import {
  loadDorks,
  saveResults,
  appendDorkResults,
  saveUrlsToFile,
} from "./utils/fileOperations.js";
import MultiEngineDorker from "./dorker/MultiEngineDorker.js";
import DashboardServer from "./web/dashboard.js";
import boxen from "boxen";

// Global dashboard instance
let dashboard = null;

/**
 * Display section separator
 */
function displaySection(title, color = "cyan") {
  console.log("\n" + "─".repeat(80));
  console.log(chalk[color].bold(`🔧 ${title}`));
  console.log("─".repeat(80) + "\n");
}

/**
 * Display clean status message
 */
function displayStatus(message, icon = "ℹ️", color = "blue") {
  console.log(chalk[color](`${icon} ${message}`));
}

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

    displaySection("System Initialization", "magenta");

    // Start dashboard server
    displayStatus("Starting live dashboard server...", "🌐", "magenta");

    dashboard = new DashboardServer(3000);
    await dashboard.start();

    displayStatus(
      "✅ Dashboard started at http://localhost:3000",
      "✓",
      "green"
    );
    displayStatus(
      "📊 Open the URL above to monitor live progress",
      "💡",
      "cyan"
    );

    // Create logger with log clearing enabled by default
    displayStatus("Initializing logging system...", "📝", "cyan");

    logger = await createLogger(true); // Always clear logs on startup
    logger.info("Starting Dorker application", { config });
    dashboard.addLog("info", "Logging system initialized");

    displayStatus("✅ Logging system ready", "✓", "green");

    // Load dorks from file
    displayStatus(`Loading dorks from ${config.dorkFile}...`, "📁", "blue");

    const dorks = await loadDorks(config.dorkFile, logger);
    if (dorks.length === 0) {
      displayError("No dorks found in file", null);
      dashboard.addLog("error", "No dorks found in file");
      process.exit(1);
    }

    dashboard.addLog("info", `Loaded ${dorks.length} dorks from file`);
    displayStatus(`✅ Loaded ${dorks.length} dorks successfully`, "✓", "green");

    // Initialize dorker
    displayStatus(
      "Initializing browser and security systems...",
      "🔒",
      "magenta"
    );

    dorker = new MultiEngineDorker(config, logger, dashboard);
    await dorker.initialize();

    dashboard.addLog("info", "Browser and security systems initialized");
    displayStatus("✅ Browser and security systems ready", "✓", "green");

    displaySection("Dorking Process", "cyan");

    // Results storage
    const allResults = {};

    // Start dashboard session
    dashboard.startSession(dorks.length);
    dashboard.setStatus("running");

    const sessionBox = boxen(
      `${chalk.bold.cyan("🚀 Dorking Session Started")}\n\n` +
        `${chalk.gray("Total Dorks:")} ${chalk.white(dorks.length)}\n` +
        `${chalk.gray("Results per Search:")} ${chalk.white(
          config.resultCount
        )}\n` +
        `${chalk.gray("Delay between Searches:")} ${chalk.white(
          config.delay
        )}s\n` +
        `${chalk.gray("Dashboard URL:")} ${chalk.white(
          "http://localhost:3000"
        )}`,
      {
        padding: 1,
        margin: 1,
        borderStyle: "double",
        borderColor: "cyan",
      }
    );

    console.log(sessionBox);

    // Process each dork
    for (let i = 0; i < dorks.length; i++) {
      const dork = dorks[i];

      try {
        console.log("\n" + "─".repeat(40));
        console.log(chalk.bold.cyan(`📍 Dork ${i + 1}/${dorks.length}`));
        console.log("─".repeat(40));

        // Update dashboard with current dork
        dashboard.setCurrentDork(dork);
        dashboard.addLog(
          "info",
          `Processing dork ${i + 1}/${dorks.length}: ${dork.substring(
            0,
            50
          )}...`
        );

        // Display current dork info
        console.log(
          chalk.gray("🔍 Query:"),
          chalk.white(dork.substring(0, 80))
        );
        if (dork.length > 80) {
          console.log(chalk.gray("   ...") + chalk.white(dork.substring(80)));
        }

        // Create search spinner
        console.log(chalk.gray("\n⏳ Searching..."));
        const searchSpinner = createSpinner(`Executing search query`, "green");
        searchSpinner.start();

        // Perform search
        const results = await dorker.performSearch(dork, config.resultCount);

        // Stop spinner and show results
        searchSpinner.stop();

        // Update dashboard with results
        dashboard.incrementProcessed();

        if (results && results.length > 0) {
          console.log(chalk.green(`✅ Found ${results.length} results`));
          dashboard.incrementSuccessful();
          dashboard.addToTotalResults(results.length);
          dashboard.addResult(dork, results);
          dashboard.addLog(
            "success",
            `Found ${results.length} results for dork`
          );

          // Show quick preview
          if (results.length > 0) {
            console.log(chalk.gray("📋 Quick Preview:"));
            results.slice(0, 3).forEach((result, idx) => {
              const title = result.title
                ? result.title.substring(0, 60)
                : "No title";
              console.log(
                chalk.gray(
                  `   ${idx + 1}. ${title}${title.length >= 60 ? "..." : ""}`
                )
              );
            });
            if (results.length > 3) {
              console.log(
                chalk.gray(`   ... and ${results.length - 3} more results`)
              );
            }
          }
        } else {
          console.log(chalk.yellow("⚠️ No results found"));
          dashboard.incrementFailed();
          dashboard.addLog("warning", "No results found for dork");
        }

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

        // Clear previous lines and display progress bar
        if (i > 0) {
          // Move cursor up to overwrite previous progress bar
          process.stdout.write("\x1B[1A\x1B[2K");
        }
        const percentage = Math.round(((i + 1) / dorks.length) * 100);
        const progressBar = "█".repeat(Math.floor(percentage / 2));
        const emptyBar = "░".repeat(50 - Math.floor(percentage / 2));
        console.log(
          chalk.gray(
            `📊 Progress: [${chalk.cyan(
              progressBar
            )}${emptyBar}] ${percentage}%`
          )
        );

        // Delay between searches (except for last dork)
        if (i < dorks.length - 1) {
          console.log(
            chalk.gray(`⏱️ Waiting ${config.delay}s before next search...`)
          );

          dashboard.addLog(
            "info",
            `Waiting ${config.delay}s before next search...`
          );

          const delaySpinner = createSpinner(`Delay in progress`, "yellow");
          delaySpinner.start();

          await dorker.delayBetweenSearches();

          delaySpinner.stop();
          console.log(chalk.green("✅ Delay completed"));
        }
      } catch (error) {
        logger.error("Error processing dork", {
          dork: dork.substring(0, 50),
          error: error.message,
          index: i + 1,
        });

        dashboard.incrementProcessed();
        dashboard.incrementFailed();
        dashboard.addLog("error", `Failed to process dork: ${error.message}`);

        console.log(chalk.red(`❌ Error processing dork: ${error.message}`));

        // Store empty results for failed dork
        allResults[dork] = [];
      }
    }

    displaySection("Session Complete", "green");

    // Mark session as completed
    dashboard.endSession();
    dashboard.addLog("success", "All dorks processed successfully");

    // Save final results
    if (config.outputFile) {
      displayStatus(
        `Saving final results to ${config.outputFile}...`,
        "💾",
        "cyan"
      );

      await saveResults(allResults, config.outputFile, logger);

      dashboard.addLog("info", `Results saved to ${config.outputFile}`);
      displayStatus(`✅ Results saved to ${config.outputFile}`, "✓", "green");
    }

    // Display final summary
    displayFinalSummary(allResults, startTime);

    // Ask if user wants to save URLs to result.txt
    const shouldSaveUrls = await askSaveUrls(allResults);
    if (shouldSaveUrls) {
      displayStatus("Saving URLs to result.txt...", "🔗", "blue");

      await saveUrlsToFile(allResults, "result.txt", logger);

      dashboard.addLog("info", "URLs saved to result.txt");
      displayStatus("✅ URLs saved to result.txt", "✓", "green");
    }

    const completionBox = boxen(
      `${chalk.bold.green("🎉 Dorking Process Completed Successfully!")}\n\n` +
        `${chalk.gray("Dashboard:")} ${chalk.white(
          "http://localhost:3000"
        )}\n` +
        `${chalk.gray(
          "Note:"
        )} Dashboard will remain active for result viewing`,
      {
        padding: 1,
        margin: 1,
        borderStyle: "double",
        borderColor: "green",
      }
    );

    console.log(completionBox);
  } catch (error) {
    if (logger) {
      logger.error("Fatal error in main process", {
        error: error.message,
        stack: error.stack,
      });
    }

    if (dashboard) {
      dashboard.addLog("error", `Fatal error: ${error.message}`);
      dashboard.setStatus("error");
    }

    displayError("Fatal application error", error);
    process.exit(1);
  } finally {
    // Cleanup resources
    if (dorker) {
      displayStatus("Cleaning up browser resources...", "🧹", "gray");

      await dorker.cleanup();

      if (dashboard) {
        dashboard.addLog("info", "Browser resources cleaned up");
      }

      displayStatus("✅ Cleanup completed", "✓", "green");
    }

    if (logger) {
      logger.info("Application shutdown completed");
    }

    // Keep dashboard running for viewing results
    if (dashboard) {
      dashboard.addLog(
        "info",
        "Dashboard remains available for viewing results"
      );

      const dashboardNotice = boxen(
        `${chalk.bold.cyan("📊 Dashboard Active")}\n\n` +
          `${chalk.gray("URL:")} ${chalk.white("http://localhost:3000")}\n` +
          `${chalk.gray("Status:")} ${chalk.green("Running")}\n\n` +
          `${chalk.yellow("Press Ctrl+C to shut down the dashboard")}`,
        {
          padding: 1,
          margin: 1,
          borderStyle: "round",
          borderColor: "cyan",
        }
      );

      console.log("\n" + dashboardNotice);
    }
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n" + "─".repeat(80));
  console.log(chalk.yellow.bold("⚠️ Received interrupt signal"));
  console.log("─".repeat(80));

  displayStatus("Shutting down gracefully...", "🛑", "yellow");

  if (dashboard) {
    dashboard.addLog("warning", "Shutting down dashboard...");
    await dashboard.stop();
    displayStatus("✅ Dashboard stopped", "✓", "green");
  }

  console.log(chalk.green("\n👋 Goodbye!"));
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n" + "─".repeat(80));
  console.log(chalk.yellow.bold("⚠️ Received termination signal"));
  console.log("─".repeat(80));

  displayStatus("Shutting down gracefully...", "🛑", "yellow");

  if (dashboard) {
    dashboard.addLog("warning", "Shutting down dashboard...");
    await dashboard.stop();
    displayStatus("✅ Dashboard stopped", "✓", "green");
  }

  process.exit(0);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  if (dashboard) {
    dashboard.addLog("error", `Uncaught Exception: ${error.message}`);
  }

  displayError("Uncaught Exception", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, _promise) => {
  if (dashboard) {
    dashboard.addLog("error", `Unhandled Promise Rejection: ${reason}`);
  }

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
