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
  parseCommandLineArgs,
} from "./ui/cli.js";
import {
  loadDorks,
  saveResults,
  appendDorkResults,
  saveUrlsToFile,
} from "./utils/fileOperations.js";
import MultiEngineDorker from "./dorker/MultiEngineDorker.js";
import DashboardServer from "./web/dashboard.js";
import { resetCaptchaDetectionState } from "./captcha/detector.js";
import boxen from "boxen";

// Global dashboard instance
let dashboard = null;
let dorker = null;
let logger = null;
let isServerMode = false; // Track if we're running in server mode

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
 * Server-only mode - starts dashboard and waits for web configuration
 */
async function serverMode(port = 3000) {
  displayBanner();
  displaySection("Server Mode", "magenta");

  // Start dashboard server
  displayStatus("Starting web dashboard server...", "🌐", "magenta");

  dashboard = new DashboardServer(port);

  // Set up server mode event handlers
  dashboard.setupServerMode({
    onStartDorking: handleStartDorking,
    onStopDorking: handleStopDorking,
  });

  await dashboard.start();

  displayStatus(
    `✅ Dashboard server started at http://localhost:${port}`,
    "✓",
    "green"
  );

  // Initialize logger
  logger = await createLogger(true);
  logger.info("Server mode started");
  dashboard.addLog("info", "Server mode started - waiting for configuration");

  const serverBox = boxen(
    `${chalk.bold.cyan("🖥️  Server Mode Active")}\n\n` +
      `${chalk.gray("Dashboard URL:")} ${chalk.white(
        `http://localhost:${port}`
      )}\n` +
      `${chalk.gray("Status:")} ${chalk.green("Ready for configuration")}\n\n` +
      `${chalk.yellow(
        "Configure and start dorking from the web interface"
      )}\n` +
      `${chalk.gray("Press Ctrl+C to shutdown the server")}`,
    {
      padding: 1,
      margin: 1,
      borderStyle: "double",
      borderColor: "cyan",
    }
  );

  console.log(serverBox);

  // Keep the server running
  return new Promise((_resolve) => {
    // Server will run until interrupted
  });
}

/**
 * Handle start dorking request from web interface
 */
async function handleStartDorking(config) {
  try {
    // START SESSION IMMEDIATELY when user clicks start
    const startMessage = "🚀 Dorking session started - initializing...";
    dashboard.addLog("info", startMessage);
    console.log(chalk.bold.magenta(`\n🌐 ${startMessage}`));
    console.log("─".repeat(50));

    // Set status to initializing immediately
    dashboard.setStatus("initializing");

    // Load dorks from file
    dashboard.addLog("info", `📁 Loading dorks from ${config.dorkFile}...`);
    console.log(chalk.blue(`📁 Loading dorks from ${config.dorkFile}...`));
    const dorks = await loadDorks(config.dorkFile, logger);

    if (dorks.length === 0) {
      const errorMessage = "No dorks found in file";
      dashboard.addLog("error", errorMessage);
      console.log(chalk.red(`❌ ${errorMessage}`));
      dashboard.setStatus("error");
      return { success: false, error: errorMessage };
    }

    // Set configuration on dashboard
    dashboard.setConfiguration(config);

    // START DASHBOARD SESSION IMMEDIATELY after loading dorks
    dashboard.startSession(dorks.length);

    const loadMessage = `✅ Loaded ${dorks.length} dorks from file`;
    dashboard.addLog("success", loadMessage);
    console.log(chalk.green(loadMessage));

    // Initialize dorker with live logging
    dashboard.addLog("info", "🔧 Initializing browser and security systems...");
    console.log(chalk.blue("🔧 Initializing browser and security systems..."));

    dorker = new MultiEngineDorker(config, logger, dashboard);
    await dorker.initialize();

    const initMessage = "✅ Browser and security systems initialized";
    dashboard.addLog("success", initMessage);
    console.log(chalk.green(initMessage));

    // Set status to running before starting dorking
    dashboard.setStatus("running");
    dashboard.addLog("info", "🎯 Starting dorking process...");

    // Start dorking process
    await performDorking(dorks, config);

    return { success: true };
  } catch (error) {
    logger.error("Error starting dorking session", { error: error.message });
    const errorMessage = `❌ Failed to start dorking: ${error.message}`;
    dashboard.addLog("error", errorMessage);
    console.log(chalk.red(errorMessage));
    dashboard.setStatus("error");
    return { success: false, error: error.message };
  }
}

/**
 * Handle stop dorking request from web interface
 */
async function handleStopDorking() {
  try {
    const stopMessage = "Stopping dorking session from web interface";
    dashboard.addLog("info", stopMessage);
    console.log(chalk.bold.yellow(`\n🛑 ${stopMessage}`));

    if (dorker) {
      console.log(chalk.blue("🧹 Cleaning up browser resources..."));
      await dorker.cleanup();
      dorker = null;
      console.log(chalk.green("✅ Browser resources cleaned up"));
    }

    dashboard.setStatus("stopped");

    const stoppedMessage = "Dorking session stopped";
    dashboard.addLog("info", stoppedMessage);
    console.log(chalk.yellow(`⏹️ ${stoppedMessage}`));
    console.log("─".repeat(50));

    return { success: true };
  } catch (error) {
    logger.error("Error stopping dorking session", { error: error.message });
    const errorMessage = `Failed to stop dorking: ${error.message}`;
    dashboard.addLog("error", errorMessage);
    console.log(chalk.red(`❌ ${errorMessage}`));
    return { success: false, error: error.message };
  }
}

/**
 * Perform the actual dorking process
 */
async function performDorking(dorks, config) {
  const allResults = {};

  // Session already started in handleStartDorking - just log the start
  console.log(chalk.bold.cyan("\n🚀 Beginning Dork Processing"));
  console.log(chalk.gray(`Total dorks: ${dorks.length}`));
  console.log("─".repeat(50));

  // Process each dork
  for (let i = 0; i < dorks.length; i++) {
    const dork = dorks[i];

    try {
      // Reset CAPTCHA detection state for new search
      resetCaptchaDetectionState();

      // Update dashboard with current dork
      dashboard.setCurrentDork(dork);

      // Log to both dashboard and console
      const processMessage = `Processing dork ${i + 1}/${
        dorks.length
      }: ${dork.substring(0, 50)}...`;
      dashboard.addLog("info", processMessage);
      console.log(chalk.cyan(`\n📍 ${processMessage}`));

      // Perform search
      const results = await dorker.performSearch(dork, config.resultCount);

      // Update dashboard with results
      dashboard.incrementProcessed();

      if (results && results.length > 0) {
        dashboard.incrementSuccessful();
        dashboard.addToTotalResults(results.length);
        dashboard.addResult(dork, results);

        // Log to console only - dashboard.addResult already logs to dashboard
        console.log(chalk.green(`✅ Found ${results.length} results for dork`));

        // Show some sample results in console
        if (results.length > 0) {
          console.log(chalk.gray("   Sample results:"));
          results.slice(0, 2).forEach((result, idx) => {
            const title = result.title
              ? result.title.substring(0, 60)
              : "No title";
            console.log(
              chalk.gray(
                `     ${idx + 1}. ${title}${title.length >= 60 ? "..." : ""}`
              )
            );
          });
          if (results.length > 2) {
            console.log(chalk.gray(`     ... and ${results.length - 2} more`));
          }
        }
      } else {
        dashboard.incrementFailed();

        // Log to both dashboard and console
        const noResultsMessage = "No results found for dork";
        dashboard.addLog("warning", noResultsMessage);
        console.log(chalk.yellow(`⚠️ ${noResultsMessage}`));
      }

      // Store results
      allResults[dork] = results;

      // Only save to output file in CLI mode, not in server mode
      if (config.outputFile && !isServerMode) {
        await appendDorkResults(
          dork,
          results,
          config.outputFile,
          allResults,
          logger
        );
      }

      // Show progress
      const percentage = Math.round(((i + 1) / dorks.length) * 100);
      const progressBar = "█".repeat(Math.floor(percentage / 2));
      const emptyBar = "░".repeat(50 - Math.floor(percentage / 2));
      console.log(
        chalk.gray(
          `📊 Progress: [${chalk.cyan(progressBar)}${emptyBar}] ${percentage}%`
        )
      );

      // Delay between searches (except for last dork)
      if (i < dorks.length - 1) {
        const delayMessage = `Waiting ${config.delay}s before next search...`;
        dashboard.addLog("info", delayMessage);
        dashboard.setStatus("delaying-search");
        console.log(chalk.gray(`⏱️ ${delayMessage}`));
        await dorker.delayBetweenSearches();
        dashboard.setStatus("running");
      }
    } catch (error) {
      logger.error("Error processing dork", {
        dork: dork.substring(0, 50),
        error: error.message,
        index: i + 1,
      });

      dashboard.incrementProcessed();
      dashboard.incrementFailed();

      // Log to both dashboard and console
      const errorMessage = `Failed to process dork: ${error.message}`;
      dashboard.addLog("error", errorMessage);
      console.log(chalk.red(`❌ ${errorMessage}`));

      // Store empty results for failed dork
      allResults[dork] = [];
    }
  }

  // Mark session as completed and auto-stop
  dashboard.endSession();
  dashboard.setStatus("completed");

  const completionMessage = "All dorks processed successfully";
  dashboard.addLog("success", completionMessage);
  console.log(chalk.green(`\n✅ ${completionMessage}`));
  console.log("─".repeat(50));

  // Save final results (only in CLI mode - server mode uses web export)
  // Note: In server mode, users can export results through the web dashboard interface
  // so we don't automatically create results.json files

  // Cleanup
  if (dorker) {
    const cleanupMessage = "Browser resources cleaned up";
    await dorker.cleanup();
    dorker = null;
    dashboard.addLog("info", cleanupMessage);
    console.log(chalk.gray(`🧹 ${cleanupMessage}`));
  }

  // Final summary and completion notification
  const sessionSummary = dashboard.getSessionSummary();

  // Send completion notification to web dashboard
  dashboard.sendNotification(
    `🎉 Dorking completed! Processed ${sessionSummary.processedDorks} dorks with ${sessionSummary.successRate}% success rate`,
    "completion",
    true
  );
  console.log(chalk.bold.green("\n🎉 Session Complete!"));
  console.log(chalk.gray(`Success Rate: ${sessionSummary.successRate}%`));
  console.log(chalk.gray(`Total Results: ${sessionSummary.totalResults}`));
  console.log(chalk.gray(`Runtime: ${sessionSummary.runtimeFormatted}`));
  console.log(chalk.cyan(`Dashboard: http://localhost:3000`));
}

/**
 * Interactive mode - original CLI workflow
 */
async function interactiveMode() {
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

          // Show quick preview in console
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

        // Only save to output file in CLI mode, not in server mode
        if (config.outputFile && !isServerMode) {
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

    // Mark session as completed and auto-stop
    dashboard.endSession();
    dashboard.setStatus("completed");
    dashboard.addLog("success", "All dorks processed successfully");

    // Send completion notification to web dashboard
    const interactiveSummary = dashboard.getSessionSummary();
    dashboard.sendNotification(
      `🎉 Interactive session completed! ${interactiveSummary.successRate}% success rate with ${interactiveSummary.totalResults} total results`,
      "completion",
      true
    );

    // Save final results (CLI mode only - creates results.json file)
    if (config.outputFile && !isServerMode) {
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
      displayStatus("Saving URLs to files...", "🔗", "blue");

      // Save both unique and all versions for comparison
      await saveUrlsToFile(allResults, "result.txt", logger, false); // unique version first

      dashboard.addLog(
        "info",
        "URLs saved to result-unique.txt and result-all.txt"
      );
      displayStatus(
        "✅ URLs saved - both unique and complete versions created",
        "✓",
        "green"
      );

      // Show user the difference
      const urls = [];
      for (const dork in allResults) {
        if (allResults[dork] && Array.isArray(allResults[dork])) {
          allResults[dork].forEach((result) => {
            if (result.url && result.url.trim()) {
              urls.push(result.url.trim());
            }
          });
        }
      }

      const uniqueCount = [...new Set(urls)].length;
      const totalCount = urls.length;
      const duplicateCount = totalCount - uniqueCount;

      if (duplicateCount > 0) {
        displayStatus(
          `📊 Total: ${totalCount} URLs, Unique: ${uniqueCount}, Duplicates: ${duplicateCount}`,
          "📈",
          "cyan"
        );
        dashboard.addLog(
          "info",
          `Statistics: ${uniqueCount} unique URLs, ${duplicateCount} duplicates removed`
        );
      }
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

/**
 * Main application entry point
 */
async function main() {
  try {
    // Parse command line arguments
    const args = parseCommandLineArgs();

    if (args.server) {
      // Server mode - start dashboard and wait for web configuration
      isServerMode = true;
      await serverMode(args.port || 3000);
    } else {
      // Interactive mode - original CLI workflow
      isServerMode = false;
      await interactiveMode();
    }
  } catch (error) {
    displayError("Application failed to start", error);
    process.exit(1);
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
