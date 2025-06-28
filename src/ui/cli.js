import * as p from "@clack/prompts";
import chalk from "chalk";
import figlet from "figlet";
import ora from "ora";
import Table from "cli-table3";
import boxen from "boxen";
import gradient from "gradient-string";

/**
 * Display application banner with gradient colors
 */
function displayBanner() {
  console.clear();
  try {
    const banner = figlet.textSync("DORKER", {
      font: "Big Money-nw",
      horizontalLayout: "default",
      verticalLayout: "default",
    });
    console.log(gradient.passion(banner));
  } catch (error) {
    console.log(gradient.passion("\n=== DORKER ==="));
  }

  const description = boxen(
    `${chalk.bold.cyan("🔍 Advanced Google Dorking Tool")}\n` +
      `${chalk.gray("Intelligent search automation with anti-detection")}\n` +
      `${chalk.gray("Built with Node.js & Puppeteer")}`,
    {
      padding: 1,
      margin: 1,
      borderStyle: "round",
      borderColor: "cyan",
      backgroundColor: "#1a1a1a",
    }
  );

  console.log(description);
}

/**
 * Display configuration summary in a professional table
 */
function displayConfig(config) {
  const configTable = new Table({
    head: [
      chalk.cyan.bold("Setting"),
      chalk.cyan.bold("Value"),
      chalk.cyan.bold("Status"),
    ],
    colWidths: [25, 35, 15],
    style: {
      head: [],
      border: ["cyan"],
    },
  });

  // Helper function to get status icon
  const getStatusIcon = (value, type = "boolean") => {
    if (type === "boolean") {
      return value ? chalk.green("✓ Enabled") : chalk.red("✗ Disabled");
    }
    return chalk.blue("📝 Set");
  };

  configTable.push(
    ["📁 Dork File", config.dorkFile, getStatusIcon(true, "file")],
    ["💾 Output File", config.outputFile, getStatusIcon(true, "file")],
    [
      "📊 Results per Search",
      config.resultCount.toString(),
      getStatusIcon(true, "number"),
    ],
    ["⏱️ Search Delay", `${config.delay}s`, getStatusIcon(true, "number")],
    ["⏸️ Max Pause", `${config.maxPause}s`, getStatusIcon(true, "number")],
    [
      "👁️ Headless Mode",
      config.headless ? "Enabled" : "Disabled",
      getStatusIcon(config.headless),
    ],
    [
      "🔐 CAPTCHA Mode",
      config.manualCaptchaMode ? "Manual" : "Automatic (Audio + Proxy)",
      getStatusIcon(true),
    ],
    [
      "🌍 Auto Proxy",
      config.autoProxy ? "ASOCKS Enabled" : "Disabled",
      getStatusIcon(config.autoProxy),
    ],
    [
      "🎭 Human-like Behavior",
      config.humanLike ? "Enabled" : "Disabled",
      getStatusIcon(config.humanLike),
    ],
    [
      "🔍 Multi-Engine",
      config.multiEngine ? "Enabled" : "Disabled",
      getStatusIcon(config.multiEngine),
    ],
    ["📝 Verbose Logging", "File Logging", getStatusIcon(true)]
  );

  console.log(
    "\n" +
      boxen(
        `${chalk.bold.magenta(
          "🔧 Configuration Summary"
        )}\n\n${configTable.toString()}`,
        {
          padding: 1,
          margin: 1,
          borderStyle: "double",
          borderColor: "magenta",
        }
      )
  );
}

/**
 * Interactive configuration with modern prompts
 */
async function getConfiguration() {
  p.intro(gradient.rainbow("🛠️ DORKER Configuration Setup"));

  const config = await p.group(
    {
      // Basic Settings
      dorkFile: () =>
        p.text({
          message: "📁 Dork file path",
          placeholder: "dorks.txt",
          defaultValue: "dorks.txt",
          validate: (value) => {
            if (!value.trim()) return "Dork file path is required";
          },
        }),

      outputFile: () =>
        p.text({
          message: "💾 Output file path",
          placeholder: "results.json",
          defaultValue: "results.json",
          validate: (value) => {
            if (!value.trim()) return "Output file path is required";
          },
        }),

      resultCount: () =>
        p.text({
          message: "📊 Results per search",
          placeholder: "30",
          defaultValue: "30",
          validate: (value) => {
            const num = parseInt(value);
            if (isNaN(num) || num < 1 || num > 100) {
              return "Must be a number between 1 and 100";
            }
          },
        }),

      delay: () =>
        p.text({
          message: "⏱️ Delay between searches (seconds)",
          placeholder: "45",
          defaultValue: "45",
          validate: (value) => {
            const num = parseInt(value);
            if (isNaN(num) || num < 5 || num > 60) {
              return "Must be between 5 and 60 seconds";
            }
          },
        }),

      maxPause: () =>
        p.text({
          message: "⏸️ Maximum pause length (seconds)",
          placeholder: "60",
          defaultValue: "60",
          validate: (value) => {
            const num = parseInt(value);
            if (isNaN(num) || num < 30 || num > 60) {
              return "Must be between 30 and 60 seconds";
            }
          },
        }),

      // Browser Settings
      headless: () =>
        p.confirm({
          message: "👁️ Run browser in headless mode?",
          initialValue: false,
        }),

      userAgent: () =>
        p.text({
          message: "🤖 Custom User Agent (optional)",
          placeholder: "Leave empty for default browser agent",
        }),

      // Security Settings
      manualCaptchaMode: () =>
        p.confirm({
          message:
            "🔐 Enable manual CAPTCHA solving? (No = Automatic with audio + proxy switching)",
          initialValue: false,
        }),

      humanLike: () =>
        p.confirm({
          message: "🎭 Enable human-like behavior simulation?",
          initialValue: true,
        }),

      // Proxy Settings
      autoProxy: () =>
        p.confirm({
          message: "🌍 Enable automatic proxy switching via ASOCKS?",
          initialValue: false,
        }),

      // Advanced Settings
      multiEngine: () =>
        p.confirm({
          message: "🔍 Enable multi-engine dorking?",
          initialValue: false,
        }),
    },
    {
      onCancel: () => {
        p.cancel("Configuration cancelled");
        process.exit(0);
      },
    }
  );

  // Process the configuration
  const processedConfig = {
    dorkFile: config.dorkFile || "dorks.txt",
    outputFile: config.outputFile || "results.json",
    resultCount: parseInt(config.resultCount) || 30,
    delay: Math.min(parseInt(config.delay) || 45, 60),
    maxPause: Math.min(parseInt(config.maxPause) || 60, 60),
    headless: config.headless,
    userAgent: config.userAgent?.trim() || null,
    manualCaptchaMode: config.manualCaptchaMode,
    humanLike: config.humanLike,
    autoProxy: config.autoProxy,
    multiEngine: config.multiEngine,
    verbose: true, // Always enabled
  };

  // Display configuration summary
  displayConfig(processedConfig);

  // Final confirmation
  const proceed = await p.confirm({
    message: "🚀 Proceed with this configuration?",
    initialValue: true,
  });

  if (!proceed) {
    p.cancel("Configuration cancelled");
    process.exit(0);
  }

  p.outro(chalk.green("✅ Configuration completed successfully!"));

  return processedConfig;
}

/**
 * Ask if user wants to save URLs with modern prompt
 */
async function askSaveUrls(results) {
  // Count total URLs
  let totalUrls = 0;
  for (const dork in results) {
    if (results[dork] && Array.isArray(results[dork])) {
      totalUrls += results[dork].length;
    }
  }

  if (totalUrls === 0) {
    p.note(chalk.yellow("No URLs found to save"), "📊 Results Summary");
    return false;
  }

  p.note(
    `Found ${chalk.bold.cyan(totalUrls)} URLs across all dorks`,
    "📊 Results Summary"
  );

  const shouldSave = await p.confirm({
    message: "💾 Save these URLs to result.txt?",
    initialValue: true,
  });

  return shouldSave;
}

/**
 * Display progress with modern spinner and progress info
 */
function displayProgress(current, total, dork) {
  const percentage = Math.round((current / total) * 100);
  const progressBar = "█".repeat(Math.floor(percentage / 5));
  const emptyBar = "░".repeat(20 - Math.floor(percentage / 5));

  const progressInfo = boxen(
    `${chalk.bold.cyan("🔍 Processing Dork")}\n\n` +
      `${chalk.gray("Current:")} ${chalk.white(dork.substring(0, 60))}${
        dork.length > 60 ? "..." : ""
      }\n` +
      `${chalk.gray("Progress:")} ${chalk.cyan(
        progressBar
      )}${emptyBar} ${chalk.bold(percentage)}%\n` +
      `${chalk.gray("Status:")} ${chalk.cyan(current)} of ${chalk.cyan(
        total
      )} dorks completed`,
    {
      padding: 1,
      margin: { top: 1 },
      borderStyle: "round",
      borderColor: "cyan",
    }
  );

  console.log(progressInfo);
}

/**
 * Display results with modern table formatting
 */
function displayResults(results, dork) {
  if (!results || results.length === 0) {
    p.note(chalk.yellow("No results found for this dork"), "🔍 Search Results");
    return;
  }

  const resultsTable = new Table({
    head: [
      chalk.cyan.bold("#"),
      chalk.cyan.bold("Title"),
      chalk.cyan.bold("URL"),
    ],
    colWidths: [5, 50, 60],
    style: {
      head: [],
      border: ["cyan"],
    },
    wordWrap: true,
  });

  results.slice(0, 5).forEach((result, index) => {
    resultsTable.push([
      chalk.bold(index + 1),
      result.title
        ? result.title.substring(0, 45) +
          (result.title.length > 45 ? "..." : "")
        : "No title",
      result.url
        ? result.url.substring(0, 55) + (result.url.length > 55 ? "..." : "")
        : "No URL",
    ]);
  });

  const resultBox = boxen(
    `${chalk.bold.green("✅ Search Results Found")}\n\n` +
      `${chalk.gray("Dork:")} ${dork.substring(0, 50)}${
        dork.length > 50 ? "..." : ""
      }\n` +
      `${chalk.gray("Results:")} ${chalk.bold.cyan(
        results.length
      )} URLs found\n\n` +
      `${chalk.gray("Preview (first 5 results):")}\n${resultsTable.toString()}`,
    {
      padding: 1,
      margin: 1,
      borderStyle: "round",
      borderColor: "green",
    }
  );

  console.log(resultBox);
}

/**
 * Display final summary with statistics
 */
function displayFinalSummary(allResults, startTime) {
  const endTime = Date.now();
  const duration = Math.round((endTime - startTime) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;

  // Calculate statistics
  let totalUrls = 0;
  let successfulDorks = 0;
  let failedDorks = 0;

  for (const dork in allResults) {
    if (
      allResults[dork] &&
      Array.isArray(allResults[dork]) &&
      allResults[dork].length > 0
    ) {
      totalUrls += allResults[dork].length;
      successfulDorks++;
    } else {
      failedDorks++;
    }
  }

  const statsTable = new Table({
    head: [chalk.cyan.bold("Metric"), chalk.cyan.bold("Value")],
    colWidths: [25, 20],
    style: {
      head: [],
      border: ["cyan"],
    },
  });

  statsTable.push(
    ["⏱️ Total Duration", `${minutes}m ${seconds}s`],
    ["🎯 Total Dorks", (successfulDorks + failedDorks).toString()],
    ["✅ Successful Dorks", successfulDorks.toString()],
    ["❌ Failed Dorks", failedDorks.toString()],
    ["🔗 Total URLs Found", totalUrls.toString()],
    [
      "📊 Success Rate",
      `${Math.round(
        (successfulDorks / (successfulDorks + failedDorks)) * 100
      )}%`,
    ]
  );

  const summaryBox = boxen(
    `${gradient.rainbow(
      "🎉 Dorking Session Complete!"
    )}\n\n${statsTable.toString()}`,
    {
      padding: 1,
      margin: 1,
      borderStyle: "double",
      borderColor: "green",
      backgroundColor: "#0a0a0a",
    }
  );

  console.log("\n" + summaryBox);
}

/**
 * Display CAPTCHA detection notice
 */
function displayCaptchaDetected(mode = "automatic") {
  let message;
  let color = "yellow";

  if (mode === "manual") {
    message =
      `${chalk.bold.yellow("🔒 CAPTCHA Detected")}\n\n` +
      `${chalk.gray("A CAPTCHA challenge has been detected.")}\n` +
      `${chalk.gray("Please solve it manually in the browser window.")}\n` +
      `${chalk.gray("The process will continue automatically after solving.")}`;
  } else {
    message =
      `${chalk.bold.cyan("🤖 CAPTCHA Detected - Automatic Mode")}\n\n` +
      `${chalk.gray("A CAPTCHA challenge has been detected.")}\n` +
      `${chalk.gray("🎵 Attempting audio CAPTCHA solving...")}\n` +
      `${chalk.gray("🔄 Will switch proxy if audio solving fails")}`;
    color = "cyan";
  }

  const captchaBox = boxen(message, {
    padding: 1,
    margin: 1,
    borderStyle: "round",
    borderColor: color,
  });

  console.log(captchaBox);
}

/**
 * Display proxy switch notification
 */
function displayProxySwitch(proxyInfo) {
  const proxyBox = boxen(
    `${chalk.bold.blue("🌍 Proxy Switch")}\n\n` +
      `${chalk.gray("Switching to new proxy endpoint")}\n` +
      `${chalk.gray("Location:")} ${chalk.white(
        proxyInfo?.country || "Unknown"
      )}\n` +
      `${chalk.gray("Endpoint:")} ${chalk.white(
        proxyInfo?.endpoint || "Unknown"
      )}`,
    {
      padding: 1,
      margin: 1,
      borderStyle: "round",
      borderColor: "blue",
    }
  );

  console.log(proxyBox);
}

/**
 * Display error message
 */
function displayError(message, error = null) {
  const errorDetails = error
    ? `\n${chalk.gray("Details:")} ${error.message}`
    : "";

  const errorBox = boxen(
    `${chalk.bold.red("❌ Error Occurred")}\n\n` +
      `${chalk.gray("Message:")} ${message}${errorDetails}`,
    {
      padding: 1,
      margin: 1,
      borderStyle: "round",
      borderColor: "red",
    }
  );

  console.log(errorBox);
}

/**
 * Create a spinner for long-running operations with console coordination
 */
function createSpinner(text, color = "cyan") {
  const spinner = ora({
    text: chalk[color](text),
    spinner: "dots12",
    color: color,
    indent: 0,
    discardStdin: false,
  });

  return spinner;
}

/**
 * Show success message with icon
 */
function displaySuccess(message) {
  const successBox = boxen(`${chalk.bold.green("✅ " + message)}`, {
    padding: 1,
    margin: 1,
    borderStyle: "round",
    borderColor: "green",
  });

  console.log(successBox);
}

/**
 * Show warning message with icon
 */
function displayWarning(message) {
  const warningBox = boxen(`${chalk.bold.yellow("⚠️ " + message)}`, {
    padding: 1,
    margin: 1,
    borderStyle: "round",
    borderColor: "yellow",
  });

  console.log(warningBox);
}

export {
  displayBanner,
  displayConfig,
  getConfiguration,
  askSaveUrls,
  displayProgress,
  displayResults,
  displayFinalSummary,
  displayCaptchaDetected,
  displayProxySwitch,
  displayError,
  createSpinner,
  displaySuccess,
  displayWarning,
};
