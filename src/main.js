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
  appendDorkResults,
  saveUrlsToFile,
  appendUrlsToFile,
} from "./utils/fileOperations.js";
import { MultiEngineDorker } from "./dorker/MultiEngineDorker.js";
import { Dashboard } from "./web/dashboard.js";
import { resetCaptchaDetectionState } from "./captcha/detector.js";
import { StandaloneSQLTester } from "./sql/standaloneSQLTester.js";
import boxen from "boxen";

// Global dashboard instance
let dashboard = null;
let dorker = null;
let logger = null;

/**
 * Display section separator
 */
function displaySection(title, color = "cyan", logger = null) {
  const separator = "─".repeat(80);
  const titleLine = `🔧 ${title}`;
  
  logger?.info(titleLine);
  console.log("\n" + separator);
  console.log(chalk[color].bold(titleLine));
  console.log(separator + "\n");
}

/**
 * Display status message
 */
function displayStatus(message, icon = "ℹ️", color = "blue", logger = null) {
  const statusMessage = `${icon} ${message}`;
  logger?.info(statusMessage);
  console.log(chalk[color](statusMessage));
}

/**
 * Standalone SQL injection testing mode
 */
async function standaloneSQLTestingMode(filePath, concurrency = 10) {
  try {
    displayBanner();
    displaySection("Standalone SQL Injection Testing", "red");
    
    console.log(chalk.blue(`📁 Input file: ${filePath}`));
    console.log(chalk.blue(`🚀 Concurrency: ${concurrency} workers`));
    console.log(chalk.blue(`💾 Output file: vuln.txt\n`));
    
    // Initialize logger
    logger = await createLogger(true);
    logger.info("Starting standalone SQL injection testing", { filePath, concurrency });
    
    // Initialize SQL tester
    const sqlTester = new StandaloneSQLTester({
      maxConcurrency: concurrency,
      testDelay: 500, // Fast testing
      headless: true,
      timeout: 30000,
      outputFile: 'vuln.txt',
      verbose: false
    });
    
    await sqlTester.initialize();
    
    // Read URLs from file
    const urls = await sqlTester.readUrlsFromFile(filePath);
    
    if (urls.length === 0) {
      console.log(chalk.yellow('⚠️ No URLs with parameters found in the file'));
      return;
    }
    
    // Test URLs
    const results = await sqlTester.testUrls(urls);
    
    // Display summary
    const successBox = boxen(
      `${chalk.bold.green("🛡️ SQL Injection Testing Completed!")}\n\n` +
        `${chalk.gray("File:")} ${chalk.white(filePath)}\n` +
        `${chalk.gray("URLs Tested:")} ${chalk.white(results.tested)}\n` +
        `${chalk.gray("Vulnerable:")} ${chalk.red(results.vulnerable)}\n` +
        `${chalk.gray("Duration:")} ${chalk.white((results.duration / 1000).toFixed(2))}s\n` +
        `${chalk.gray("Rate:")} ${chalk.white((results.tested / (results.duration / 1000)).toFixed(1))} URLs/s`,
      {
        padding: 1,
        margin: 1,
        borderStyle: "double",
        borderColor: results.vulnerable > 0 ? "red" : "green",
      }
    );
    
    console.log(successBox);
    
    if (results.vulnerable > 0) {
      console.log(chalk.red(`🚨 Found ${results.vulnerable} vulnerable URLs saved to vuln.txt`));
    } else {
      console.log(chalk.green(`✅ No SQL injection vulnerabilities found`));
    }
    
    // Cleanup
    await sqlTester.cleanup();
    
    logger.info("Standalone SQL injection testing completed", { results });
    
  } catch (error) {
    console.error(chalk.red('❌ Standalone SQL injection testing failed:'), error.message);
    logger?.error("Standalone SQL injection testing failed", { error: error.message });
    process.exit(1);
  }
}

/**
 * Server-only mode - starts dashboard and waits for web configuration
 */
async function serverMode(port = 3000) {
  displayBanner();
  displaySection("Server Mode", "magenta");

  // Initialize logger first
  logger = await createLogger(true);
  logger.info("Server mode started");

  // Start dashboard server
  displayStatus("Starting web dashboard server...", "🌐", "magenta");

  dashboard = new Dashboard({ port }, logger);  // Pass logger here

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

  // Add log to dashboard
  dashboard.addLog("info", "Server mode started");
  dashboard.addLog("info", `Dashboard server running at http://localhost:${port}`);
  dashboard.addLog("info", "Ready to process dorks - use the web interface to start");
  
  // Send server status to dashboard
  if (dashboard.currentSocket) {
    dashboard.sendNotification("Server is ready - connect successful!", "success");
  }
  
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

  logger?.info("ThreatDorker Server Started in server mode - Dashboard available at http://localhost:" + port);
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
    logger?.info(startMessage);
    console.log(chalk.bold.magenta(`\n🌐 ${startMessage}`));
    console.log("─".repeat(50));

    // Set status to initializing immediately
    dashboard.setStatus("initializing");

    // Load dorks from file
    const loadingMessage = `📁 Loading dorks from ${config.dorkFile}...`;
    dashboard.addLog("info", loadingMessage);
    logger?.info(loadingMessage);
    console.log(chalk.blue(loadingMessage));
    const dorks = await loadDorks(config.dorkFile, logger);

    if (dorks.length === 0) {
      const errorMessage = "No dorks found in file";
      dashboard.addLog("error", errorMessage);
      logger?.error(errorMessage);
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
    logger?.info(loadMessage);
    console.log(chalk.green(loadMessage));

    // Initialize dorker with live logging
    const initializingMessage = "🔧 Initializing browser and security systems...";
    dashboard.addLog("info", initializingMessage);
    logger?.info(initializingMessage);
    console.log(chalk.blue(initializingMessage));

    dorker = new MultiEngineDorker(config, logger, dashboard);
    await dorker.initialize();

    const initMessage = "✅ Browser and security systems initialized";
    dashboard.addLog("success", initMessage);
    logger?.info(initMessage);
    console.log(chalk.green(initMessage));

    // Set status to running before starting dorking
    dashboard.setStatus("running");
    dashboard.addLog("info", "🎯 Starting dorking process...");

    // Start dorking process
    await performDorking(dorks, config);

    return { success: true };
  } catch (error) {
    logger?.error("Error starting dorking session", { error: error.message });
    const errorMessage = `❌ Failed to start dorking: ${error.message}`;
    dashboard.addLog("error", errorMessage);
    logger?.error(errorMessage);
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
    logger?.info(stopMessage);
    console.log(chalk.bold.yellow(`\n🛑 ${stopMessage}`));

    if (dorker) {
      const cleanupMessage = "🧹 Cleaning up browser resources...";
      logger?.info(cleanupMessage);
      console.log(chalk.blue(cleanupMessage));
      await dorker.cleanup();
      dorker = null;
      const cleanedMessage = "✅ Browser resources cleaned up";
      logger?.info(cleanedMessage);
      console.log(chalk.green(cleanedMessage));
    }

    // End the dashboard session properly
    dashboard.endSession();
    dashboard.setStatus("stopped");

    const stoppedMessage = "Dorking session stopped";
    dashboard.addLog("info", stoppedMessage);
    logger?.info(stoppedMessage);
    console.log(chalk.yellow(`⏹️ ${stoppedMessage}`));
    console.log("─".repeat(50));

    return { success: true };
  } catch (error) {
    logger?.error("Error stopping dorking session", { error: error.message });
    const errorMessage = `Failed to stop dorking: ${error.message}`;
    dashboard.addLog("error", errorMessage);
    logger?.error(errorMessage);
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
  const beginMessage = "🚀 Beginning Dork Processing";
  const totalMessage = `Total dorks: ${dorks.length}`;
  logger?.info(beginMessage);
  logger?.info(totalMessage);
  console.log(chalk.bold.cyan("\n" + beginMessage));
  console.log(chalk.gray(totalMessage));
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
      logger?.info(processMessage);
      console.log(chalk.cyan(`\n📍 ${processMessage}`));

      // Create and start spinner for this dork
      const dorkSpinner = createSpinner(
        `🔍 Searching: ${dork.substring(0, 60)}${dork.length > 60 ? "..." : ""}`,
        "cyan"
      );
      dorkSpinner.start();

      // Update dashboard with spinner status
      dashboard.setProcessingStatus?.(`🔄 Searching: ${dork.substring(0, 50)}...`);

      let results;
      try {
        // Set up logger to stop spinner during log messages
        if (logger && typeof logger.setSpinner === 'function') {
          logger.setSpinner(dorkSpinner);
        }
        
        // Perform search
        results = await dorker.performSearch(dork, config.resultCount, config.engines);
        
        // Clear spinner reference from logger
        if (logger && typeof logger.setSpinner === 'function') {
          logger.setSpinner(null);
        }
        
        // Stop spinner and show success
        dorkSpinner.succeed(`✅ Found ${results ? results.length : 0} results for dork`);
        
      } catch (searchError) {
        // Clear spinner reference from logger
        if (logger && typeof logger.setSpinner === 'function') {
          logger.setSpinner(null);
        }
        
        // Stop spinner and show error
        dorkSpinner.fail(`❌ Search failed: ${searchError.message}`);
        results = [];
      }
      
      // Clear dashboard processing status
      dashboard.setProcessingStatus?.(null);

      // Update dashboard with results
      dashboard.incrementProcessed();

      if (results && results.length > 0) {
        dashboard.incrementSuccessful();
        dashboard.addToTotalResults(results.length);
        dashboard.addResult(dork, results);

        // Log to console only - dashboard.addResult already logs to dashboard
        const resultsMessage = `✅ Found ${results.length} results for dork`;
        logger?.info(resultsMessage);
        console.log(chalk.green(resultsMessage));

        // Show some sample results in console
        if (results.length > 0) {
          logger?.debug("Sample results preview");
          console.log(chalk.gray("   Sample results:"));
          results.slice(0, 2).forEach((result, idx) => {
            const title = result.title
              ? result.title.substring(0, 60)
              : "No title";
            const sampleResult = `     ${idx + 1}. ${title}${title.length >= 60 ? "..." : ""}`;
            logger?.debug(sampleResult);
            console.log(chalk.gray(sampleResult));
          });
          if (results.length > 2) {
            const moreResults = `     ... and ${results.length - 2} more`;
            logger?.debug(moreResults);
            console.log(chalk.gray(moreResults));
          }
        }
      } else {
        dashboard.incrementFailed();

        // Log to both dashboard and console
        const noResultsMessage = "No results found for dork";
        dashboard.addLog("warning", noResultsMessage);
        logger?.warn(noResultsMessage);
        console.log(chalk.yellow(`⚠️ ${noResultsMessage}`));
      }

      // Store results
      allResults[dork] = results;

      // Append results to file if outputFile is specified
      if (config.outputFile) {
        if (config.outputFile.endsWith('.json')) {
          await appendDorkResults(dork, results, config.outputFile, allResults, logger);
        } else if (config.outputFile.endsWith('.txt')) {
          const urls = results.map(r => r.url).filter(Boolean);
          if (urls.length > 0) {
            await appendUrlsToFile(urls, config.outputFile, logger);
          }
        }
      }

      // Show progress
      const percentage = Math.round(((i + 1) / dorks.length) * 100);
      const progressBar = "█".repeat(Math.floor(percentage / 2));
      const emptyBar = "░".repeat(50 - Math.floor(percentage / 2));
      const progressMessage = `📊 Progress: [${progressBar}${emptyBar}] ${percentage}%`;
      logger?.debug(progressMessage);
      console.log(chalk.gray(`📊 Progress: [${chalk.cyan(progressBar)}${emptyBar}] ${percentage}%`));

      // Delay between searches (except for last dork)
      if (i < dorks.length - 1) {
        const delayMessage = config.extendedDelay
          ? "Waiting 1-5 minutes before next search (Extended Mode)..."
          : `Waiting ${config.delay || config.minDelay || 10}-${
              config.maxDelay || config.delay || 45
            }s before next search...`;
        dashboard.addLog("info", delayMessage);
        logger?.info(delayMessage);
        dashboard.setStatus("delaying-search");
        console.log(chalk.gray(`⏱️ ${delayMessage}`));
        await dorker.delayBetweenSearches();
        dashboard.setStatus("running");
      }
    } catch (error) {
      logger?.error("Error processing dork", {
        dork: dork.substring(0, 50),
        error: error.message,
        index: i + 1,
      });

      dashboard.incrementProcessed();
      dashboard.incrementFailed();

      // Log to both dashboard and console
      const errorMessage = `Failed to process dork: ${error.message}`;
      dashboard.addLog("error", errorMessage);
      logger?.error(errorMessage);
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
  logger?.info(completionMessage);
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
    logger?.info(cleanupMessage);
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
  const completionNotification = `🎉 Session Complete! Success Rate: ${sessionSummary.successRate}%, Total Results: ${sessionSummary.totalResults}, Runtime: ${sessionSummary.runtimeFormatted}`;
  logger?.info(completionNotification);
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

    displaySection("System Initialization", "magenta", logger);

    // Create logger with log clearing enabled by default
    displayStatus("Initializing logging system...", "📝", "cyan", logger);

    logger = await createLogger(true); // Always clear logs on startup
    logger.info("Starting ThreatDorker application", { config });

    displayStatus("✅ Logging system ready", "✓", "green", logger);

      // Process the configuration
  const minDelay = parseInt(config.minDelay) || 10;
  const maxDelay = parseInt(config.maxDelay) || 20;

    // Validate delay range
    if (maxDelay <= minDelay) {
      displayError("Maximum delay must be greater than minimum delay", null);
      process.exit(1);
    }

    // Ensure we have valid engines configuration
    const engines = config.multiEngine && Array.isArray(config.engines) && config.engines.length > 0
      ? config.engines
      : ['google'];

          const processedConfig = {
        dorkFile: config.dorkFile || "dorks.txt",
        outputFile: config.outputFile?.trim() || null,
        resultCount: parseInt(config.resultCount) || 30,
        maxPages: Math.min(parseInt(config.maxPages) || 1, 10),
        minDelay: Math.max(minDelay, 5),
        maxDelay: Math.min(maxDelay, 120),
        extendedDelay: config.extendedDelay,
            maxPause: Math.min(parseInt(config.maxPause) || 19, 60),
        headless: config.headless,
        userAgent: config.userAgent?.trim() || null,
        manualCaptchaMode: config.manualCaptchaMode,
        humanLike: config.humanLike,
        disableWarmup: config.disableWarmup,
        disableMovements: config.disableMovements || false,
        autoProxy: config.autoProxy,
          multiEngine: config.multiEngine,
          engines: engines,
          filteringType: config.filteringType || 'dork',
          dorkFiltering: (config.filteringType || 'dork') === 'dork',
          sqlInjectionTesting: config.sqlInjectionTesting || false,
          verbose: true, // Always enabled
        };

    // Load dorks from file
    displayStatus(`Loading dorks from ${processedConfig.dorkFile}...`, "📁", "blue", logger);

    const dorks = await loadDorks(processedConfig.dorkFile, logger);
    if (dorks.length === 0) {
      displayError("No dorks found in file", null);
      process.exit(1);
    }

    displayStatus(`✅ Loaded ${dorks.length} dorks successfully`, "✓", "green", logger);

    // Initialize dorker
    displayStatus(
      "Initializing browser and security systems...",
      "🔒",
      "magenta",
      logger
    );

    dorker = new MultiEngineDorker(processedConfig, logger, null);
    await dorker.initialize();

    displayStatus("✅ Browser and security systems ready", "✓", "green", logger);

    displaySection("Dorking Process", "cyan", logger);

    // Results storage
    const allResults = {};

    const sessionBox = boxen(
      `${chalk.bold.cyan("🚀 Dorking Session Started")}\n\n` +
        `${chalk.gray("Total Dorks:")} ${chalk.white(dorks.length)}\n` +
        `${chalk.gray("Results per Search:")} ${chalk.white(
          processedConfig.resultCount
        )}\n` +
        `${chalk.gray("Delay between Searches:")} ${chalk.white(
          processedConfig.extendedDelay
            ? "1-5 minutes (Extended Mode)"
            : `${processedConfig.minDelay}-${
                processedConfig.maxDelay
              }s`
        )}`,
      {
        padding: 1,
        margin: 1,
        borderStyle: "double",
        borderColor: "cyan",
      }
    );

    logger?.info("Dorking session started in interactive mode");
    console.log(sessionBox);

    // Process each dork
    for (let i = 0; i < dorks.length; i++) {
      const dork = dorks[i];

      try {
        const dorkProgress = `📍 Dork ${i + 1}/${dorks.length}`;
        logger?.info(dorkProgress);
        console.log("\n" + "─".repeat(40));
        console.log(chalk.bold.cyan(dorkProgress));
        console.log("─".repeat(40));

        // Processing dork (no dashboard in CLI mode)

        // Display current dork info
        const queryInfo = `🔍 Query: ${dork}`;
        logger?.info(queryInfo);
        console.log(
          chalk.gray("🔍 Query:"),
          chalk.white(dork.substring(0, 80))
        );
        if (dork.length > 80) {
          console.log(chalk.gray("   ...") + chalk.white(dork.substring(80)));
        }

        // Create search spinner with detailed message
        const searchSpinner = createSpinner(
          `🔍 Searching: ${dork.substring(0, 60)}${dork.length > 60 ? "..." : ""}`, 
          "cyan"
        );
        searchSpinner.start();

        let results;
        try {
          // Perform search with selected engines
          results = await dorker.performSearch(
            dork, 
            processedConfig.resultCount, 
            processedConfig.multiEngine ? processedConfig.engines : ['google']
          );
          
          // Stop spinner and show success
          searchSpinner.succeed(`✅ Found ${results ? results.length : 0} results`);

          // Store results
          allResults[dork] = results;

          // Save results to file if specified
          if (processedConfig.outputFile) {
            const saveSpinner = createSpinner('💾 Saving results...', 'cyan');
            saveSpinner.start();
            
            try {
              if (processedConfig.outputFile.endsWith('.json')) {
                await appendDorkResults(dork, results, processedConfig.outputFile, allResults, logger);
              } else if (processedConfig.outputFile.endsWith('.txt')) {
                const urls = results.map(r => r.url).filter(Boolean);
                if (urls.length > 0) {
                  await appendUrlsToFile(urls, processedConfig.outputFile, logger);
                }
              }
              saveSpinner.succeed('✅ Results saved successfully');
            } catch (saveError) {
              saveSpinner.fail(`❌ Failed to save results: ${saveError.message}`);
              logger.error('Failed to save results', { error: saveError.message });
            }
          }
          
        } catch (searchError) {
          // Stop spinner and show error
          searchSpinner.fail(`❌ Search failed: ${searchError.message}`);
          results = [];
        }

        if (results && results.length > 0) {
          const foundMessage = `✅ Found ${results.length} results`;
          logger?.info(foundMessage);
          console.log(chalk.green(foundMessage));

          // Show quick preview in console
          if (results.length > 0) {
            logger?.debug("Showing quick preview of results");
            console.log(chalk.gray("📋 Quick Preview:"));
            results.slice(0, 3).forEach((result, idx) => {
              const title = result.title
                ? result.title.substring(0, 60)
                : "No title";
              const previewLine = `   ${idx + 1}. ${title}${title.length >= 60 ? "..." : ""}`;
              logger?.debug(previewLine);
              console.log(chalk.gray(previewLine));
            });
            if (results.length > 3) {
              const moreResultsLine = `   ... and ${results.length - 3} more results`;
              logger?.debug(moreResultsLine);
              console.log(chalk.gray(moreResultsLine));
            }
          }
        } else {
          const noResultsMessage = "⚠️ No results found";
          logger?.warn(noResultsMessage);
          console.log(chalk.yellow(noResultsMessage));
        }

        // Clear previous lines and display progress bar
        if (i > 0) {
          // Move cursor up to overwrite previous progress bar
          process.stdout.write("\x1B[1A\x1B[2K");
        }
        const percentage = Math.round(((i + 1) / dorks.length) * 100);
        const progressBar = "█".repeat(Math.floor(percentage / 2));
        const emptyBar = "░".repeat(50 - Math.floor(percentage / 2));
        const progressMessage = `📊 Progress: [${progressBar}${emptyBar}] ${percentage}%`;
        logger?.debug(progressMessage);
        console.log(
          chalk.gray(
            `📊 Progress: [${chalk.cyan(
              progressBar
            )}${emptyBar}] ${percentage}%`
          )
        );

        // Delay between searches (except for last dork)
        if (i < dorks.length - 1) {
          const delaySpinner = createSpinner(
            processedConfig.extendedDelay 
              ? `⏳ Extended delay in progress (1-5 minutes)...`
              : `⏳ Delay in progress (${processedConfig.minDelay}-${processedConfig.maxDelay}s)...`, 
            "yellow"
          );
          delaySpinner.start();

          await dorker.delayBetweenSearches();

          delaySpinner.succeed("✅ Delay completed, continuing to next dork");
        }
      } catch (error) {
        logger?.error("Error processing dork", {
          dork: dork.substring(0, 50),
          error: error.message,
          index: i + 1,
        });

        const errorMessage = `❌ Error processing dork: ${error.message}`;
        logger?.error(errorMessage);
        console.log(chalk.red(errorMessage));

        // Store empty results for failed dork
        allResults[dork] = [];
      }
    }

    displaySection("Session Complete", "green", logger);

    // Note: We no longer automatically save JSON results - only save URLs if user agrees

    // Display final summary
    displayFinalSummary(allResults, startTime);

    if (!processedConfig.outputFile) {
      // Ask if user wants to save URLs to result.txt
      const shouldSaveUrls = await askSaveUrls(allResults);
      if (shouldSaveUrls) {
        displayStatus("Saving URLs to files...", "🔗", "blue", logger);

        // Save both unique and all versions for comparison
        await saveUrlsToFile(allResults, "result.txt", logger, false); // unique version first

        displayStatus(
          "✅ URLs saved - both unique and complete versions created",
          "✓",
          "green",
          logger
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
            "cyan",
            logger
          );
        }
      }
    }

    const completionBox = boxen(
      `${chalk.bold.green("🎉 Dorking Process Completed Successfully!")}\n\n` +
        `${chalk.gray("All dorks have been processed and results saved.")}`,
      {
        padding: 1,
        margin: 1,
        borderStyle: "double",
        borderColor: "green",
      }
    );

    logger?.info("Dorking process completed successfully in interactive mode");
    console.log(completionBox);
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
      displayStatus("Cleaning up browser resources...", "🧹", "gray", logger);

      await dorker.cleanup();

      displayStatus("✅ Cleanup completed", "✓", "green", logger);
    }

    if (logger) {
      logger.info("Application shutdown completed");
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

    if (args.testSql) {
      // Standalone SQL injection testing mode
      await standaloneSQLTestingMode(args.testSql, args.concurrency || 10);
      return;
    } else if (args.fast) {
      // Fast mode - skip banner and jump directly to configuration
      displayBanner(); // Still display banner for fast mode
      const config = await getConfiguration();
      displaySection("System Initialization", "magenta", logger);
      logger = await createLogger(true);
      logger.info("Starting ThreatDorker application (Fast Mode)", { config });
      displayStatus("✅ Logging system ready", "✓", "green", logger);

      const minDelay = parseInt(config.minDelay) || 10;
      const maxDelay = parseInt(config.maxDelay) || 20;

      if (maxDelay <= minDelay) {
        displayError("Maximum delay must be greater than minimum delay", null);
        process.exit(1);
      }

      const engines = config.multiEngine && Array.isArray(config.engines) && config.engines.length > 0
        ? config.engines
        : ['google'];

      const processedConfig = {
        dorkFile: config.dorkFile || "dorks.txt",
        outputFile: config.outputFile?.trim() || null,
        resultCount: parseInt(config.resultCount) || 30,
        maxPages: Math.min(parseInt(config.maxPages) || 1, 10),
        minDelay: Math.max(minDelay, 5),
        maxDelay: Math.min(maxDelay, 120),
        extendedDelay: config.extendedDelay,
            maxPause: Math.min(parseInt(config.maxPause) || 19, 60),
        headless: config.headless,
        userAgent: config.userAgent?.trim() || null,
        manualCaptchaMode: config.manualCaptchaMode,
        humanLike: config.humanLike,
        disableWarmup: config.disableWarmup,
        disableMovements: args.disableMovements || config.disableMovements || false,
        autoProxy: config.autoProxy,
        multiEngine: config.multiEngine,
        engines: engines,
        filteringType: config.filteringType || 'dork',
        dorkFiltering: (config.filteringType || 'dork') === 'dork',
        sqlInjectionTesting: config.sqlInjectionTesting || false,
        verbose: true, // Always enabled
      };

      displayStatus(`Loading dorks from ${processedConfig.dorkFile}...`, "📁", "blue", logger);
      const dorks = await loadDorks(processedConfig.dorkFile, logger);
      if (dorks.length === 0) {
        displayError("No dorks found in file", null);
        process.exit(1);
      }
      displayStatus(`✅ Loaded ${dorks.length} dorks successfully`, "✓", "green", logger);

      displayStatus(
        "Initializing browser and security systems...",
        "🔒",
        "magenta",
        logger
      );
      dorker = new MultiEngineDorker(processedConfig, logger, null);
      await dorker.initialize();
      displayStatus("✅ Browser and security systems ready", "✓", "green", logger);

      displaySection("Dorking Process", "cyan", logger);
      const allResults = {};
      const sessionBox = boxen(
        `${chalk.bold.cyan("🚀 Dorking Session Started")}\n\n` +
          `${chalk.gray("Total Dorks:")} ${chalk.white(dorks.length)}\n` +
          `${chalk.gray("Results per Search:")} ${chalk.white(
            processedConfig.resultCount
          )}\n` +
          `${chalk.gray("Delay between Searches:")} ${chalk.white(
            processedConfig.extendedDelay
              ? "1-5 minutes (Extended Mode)"
              : `${processedConfig.minDelay}-${
                  processedConfig.maxDelay
                }s`
          )}`,
        {
          padding: 1,
          margin: 1,
          borderStyle: "double",
          borderColor: "cyan",
        }
      );
      logger?.info("Fast mode dorking session started");
      console.log(sessionBox);

      for (let i = 0; i < dorks.length; i++) {
        const dork = dorks[i];
        try {
          const dorkProgress = `📍 Dork ${i + 1}/${dorks.length}`;
          logger?.info(dorkProgress);
          console.log("\n" + "─".repeat(40));
          console.log(chalk.bold.cyan(dorkProgress));
          console.log("─".repeat(40));

          // Display current dork info
          const queryInfo = `🔍 Query: ${dork}`;
          logger?.info(queryInfo);
          console.log(
            chalk.gray("🔍 Query:"),
            chalk.white(dork.substring(0, 80))
          );
          if (dork.length > 80) {
            console.log(chalk.gray("   ...") + chalk.white(dork.substring(80)));
          }

          const searchSpinner = createSpinner(
            `🔍 Searching: ${dork.substring(0, 60)}${dork.length > 60 ? "..." : ""}`, 
            "cyan"
          );
          searchSpinner.start();

          let results;
          try {
            results = await dorker.performSearch(
              dork, 
              processedConfig.resultCount, 
              processedConfig.multiEngine ? processedConfig.engines : ['google']
            );
            searchSpinner.succeed(`✅ Found ${results ? results.length : 0} results`);
            allResults[dork] = results;

            if (processedConfig.outputFile) {
              const saveSpinner = createSpinner('💾 Saving results...', 'cyan');
              saveSpinner.start();
              
              try {
                if (processedConfig.outputFile.endsWith('.json')) {
                  await appendDorkResults(dork, results, processedConfig.outputFile, allResults, logger);
                } else if (processedConfig.outputFile.endsWith('.txt')) {
                  const urls = results.map(r => r.url).filter(Boolean);
                  if (urls.length > 0) {
                    await appendUrlsToFile(urls, processedConfig.outputFile, logger);
                  }
                }
                saveSpinner.succeed('✅ Results saved successfully');
              } catch (saveError) {
                saveSpinner.fail(`❌ Failed to save results: ${saveError.message}`);
                logger.error('Failed to save results', { error: saveError.message });
              }
            }
            
          } catch (searchError) {
            searchSpinner.fail(`❌ Search failed: ${searchError.message}`);
            results = [];
          }

          if (results && results.length > 0) {
            const foundMessage = `✅ Found ${results.length} results`;
            logger?.info(foundMessage);
            console.log(chalk.green(foundMessage));
            if (results.length > 0) {
              logger?.debug("Showing quick preview of results");
              console.log(chalk.gray("📋 Quick Preview:"));
              results.slice(0, 3).forEach((result, idx) => {
                const title = result.title
                  ? result.title.substring(0, 60)
                  : "No title";
                const previewLine = `   ${idx + 1}. ${title}${title.length >= 60 ? "..." : ""}`;
                logger?.debug(previewLine);
                console.log(chalk.gray(previewLine));
              });
              if (results.length > 3) {
                const moreResultsLine = `   ... and ${results.length - 3} more results`;
                logger?.debug(moreResultsLine);
                console.log(chalk.gray(moreResultsLine));
              }
            }
          } else {
            const noResultsMessage = "⚠️ No results found";
            logger?.warn(noResultsMessage);
            console.log(chalk.yellow(noResultsMessage));
          }

          if (i > 0) {
            process.stdout.write("\x1B[1A\x1B[2K");
          }
          const percentage = Math.round(((i + 1) / dorks.length) * 100);
          const progressBar = "█".repeat(Math.floor(percentage / 2));
          const emptyBar = "░".repeat(50 - Math.floor(percentage / 2));
          const progressMessage = `📊 Progress: [${progressBar}${emptyBar}] ${percentage}%`;
          logger?.debug(progressMessage);
          console.log(
            chalk.gray(
              `📊 Progress: [${chalk.cyan(
                progressBar
              )}${emptyBar}] ${percentage}%`
            )
          );

          if (i < dorks.length - 1) {
            const delaySpinner = createSpinner(
              processedConfig.extendedDelay 
                ? `⏳ Extended delay in progress (1-5 minutes)...`
                : `⏳ Delay in progress (${processedConfig.minDelay}-${processedConfig.maxDelay}s)...`, 
              "yellow"
            );
            delaySpinner.start();

            await dorker.delayBetweenSearches();

            delaySpinner.succeed("✅ Delay completed, continuing to next dork");
          }
        } catch (error) {
          logger?.error("Error processing dork", {
            dork: dork.substring(0, 50),
            error: error.message,
            index: i + 1,
          });

          const errorMessage = `❌ Error processing dork: ${error.message}`;
          logger?.error(errorMessage);
          console.log(chalk.red(errorMessage));

          allResults[dork] = [];
        }
      }

      displaySection("Session Complete", "green", logger);
      displayFinalSummary(allResults, Date.now());

      if (!processedConfig.outputFile) {
        const shouldSaveUrls = await askSaveUrls(allResults);
        if (shouldSaveUrls) {
          displayStatus("Saving URLs to files...", "🔗", "blue", logger);
          await saveUrlsToFile(allResults, "result.txt", logger, false);
          displayStatus(
            "✅ URLs saved - both unique and complete versions created",
            "✓",
            "green",
            logger
          );
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
              "cyan",
              logger
            );
          }
        }
      }

      const completionBox = boxen(
        `${chalk.bold.green("🎉 Dorking Process Completed Successfully!")}\n\n` +
          `${chalk.gray("All dorks have been processed and results saved.")}`,
        {
          padding: 1,
          margin: 1,
          borderStyle: "double",
          borderColor: "green",
        }
      );
      logger?.info("Fast mode dorking process completed successfully");
      console.log(completionBox);
    } else if (args.server) {
      // Server mode - start dashboard and wait for web configuration
      await serverMode(args.port || 3000);
    } else {
      // Interactive mode - original CLI workflow
      await interactiveMode();
    }
  } catch (error) {
    displayError("Application failed to start", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  logger?.warn("Received interrupt signal - shutting down gracefully");
  console.log("\n" + "─".repeat(80));
  console.log(chalk.yellow.bold("⚠️ Received interrupt signal"));
  console.log("─".repeat(80));

  displayStatus("Shutting down gracefully...", "🛑", "yellow", logger);

  // Cleanup browser instances first
  if (dorker) {
    try {
      displayStatus("Cleaning up browser resources...", "🧹", "yellow", logger);
      await dorker.cleanup();
      dorker = null;
      displayStatus("✅ Browser resources cleaned up", "✓", "green", logger);
    } catch (error) {
      logger?.error("Error during browser cleanup", { error: error.message });
      displayStatus("⚠️ Browser cleanup had issues", "⚠", "yellow", logger);
    }
  }

  if (dashboard) {
    dashboard.addLog("warning", "Shutting down dashboard...");
    await dashboard.stop();
    displayStatus("✅ Dashboard stopped", "✓", "green", logger);
  }

  logger?.info("Application shutdown completed successfully");
  console.log(chalk.green("\n👋 Goodbye!"));
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger?.warn("Received termination signal - shutting down gracefully");
  console.log("\n" + "─".repeat(80));
  console.log(chalk.yellow.bold("⚠️ Received termination signal"));
  console.log("─".repeat(80));

  displayStatus("Shutting down gracefully...", "🛑", "yellow", logger);

  // Cleanup browser instances first
  if (dorker) {
    try {
      displayStatus("Cleaning up browser resources...", "🧹", "yellow", logger);
      await dorker.cleanup();
      dorker = null;
      displayStatus("✅ Browser resources cleaned up", "✓", "green", logger);
    } catch (error) {
      logger?.error("Error during browser cleanup", { error: error.message });
      displayStatus("⚠️ Browser cleanup had issues", "⚠", "yellow", logger);
    }
  }

  if (dashboard) {
    dashboard.addLog("warning", "Shutting down dashboard...");
    await dashboard.stop();
    displayStatus("✅ Dashboard stopped", "✓", "green", logger);
  }

  logger?.info("Application termination completed successfully");
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
