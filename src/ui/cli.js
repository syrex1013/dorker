import * as p from "@clack/prompts";
import chalk from "chalk";
import figlet from "figlet";
import ora from "ora";
import Table from "cli-table3";
import boxen from "boxen";
import gradient from "gradient-string";
import { Command } from "commander";

/**
 * Display application banner with gradient colors
 */
function displayBanner() {
  console.clear();
  try {
    const banner = figlet.textSync("THREATDORKER", {
      font: "Big Money-nw",
      horizontalLayout: "default",
      verticalLayout: "default",
    });
    console.log(gradient.passion(banner));
  } catch (error) {
    console.log(gradient.passion("\n=== THREATDORKER ==="));
  }

  const description = boxen(
    `${chalk.bold.red("🚨 Advanced Threat Research & Google Dorking Tool")}\n` +
      `${chalk.gray("Intelligent search automation with anti-detection")}\n` +
      `${chalk.gray("Built with Node.js & Puppeteer")}`,
    {
      padding: 1,
      margin: 1,
      borderStyle: "round",
      borderColor: "red",
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
    [
      "💾 Output File",
      config.outputFile || "URLs only at end",
      getStatusIcon(!!config.outputFile, "file"),
    ],
    [
      "📊 Results per Search",
      config.resultCount.toString(),
      getStatusIcon(true, "number"),
    ],
    [
      "📄 Max Pages per Dork",
      config.maxPages.toString(),
      getStatusIcon(true, "number"),
    ],
    [
      "⏱️ Delay Range",
      config.extendedDelay
        ? "1-5 minutes (Extended Mode)"
        : `${config.minDelay || config.delay || 10}-${
            config.maxDelay || config.delay || 20
          }s`,
      getStatusIcon(true, "number"),
    ],
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
      "⏩ Warmup Session",
      config.disableWarmup ? "Disabled" : "Enabled",
      getStatusIcon(!config.disableWarmup),
    ],
    [
      "🚀 Mouse Movements",
      config.disableMovements ? "Disabled (Faster)" : "Enabled (Stealthier)",
      getStatusIcon(!config.disableMovements),
    ],
    [
      "🔍 Multi-Engine",
      config.multiEngine ? "Enabled" : "Disabled",
      getStatusIcon(config.multiEngine),
    ],
    [
      "🎯 Search Engines",
      config.multiEngine && config.engines
        ? config.engines.join(', ')
        : "Google (default)",
      getStatusIcon(true, "file"),
    ],
    [
      "🎯 Filtering Type",
      config.filteringType === 'parameter' ? "Parameter" : "Dork based",
      getStatusIcon(true, "file"),
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
  // Fast startup: skip interactive configuration and use defaults
  const args = parseCommandLineArgs();
  if (args.fast) {
    return {
      dorkFile: "dorks.txt",
      outputFile: "fast.txt",
      resultCount: 30,
      maxPages: 1,
      minDelay: 10,
      maxDelay: 20,
      extendedDelay: false,
      maxPause: 10,
      headless: true,
      userAgent: null,
      manualCaptchaMode: false,
      humanLike: true,
      disableWarmup: true,
      disableMovements: true,
      autoProxy: true,
      multiEngine: true,
      engines: ["google", "bing", "duckduckgo"],
      filteringType: "parameter",
      dorkFiltering: true,
      sqlInjectionTesting: false,
      verbose: true,
    };
  }
  p.intro(gradient.rainbow("🛠️ THREATDORKER Configuration Setup"));

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
          message:
            "�� Output file path (e.g., results.json or results.txt)",
          placeholder: "Leave empty for URL-only output at the end",
          validate: (value) => {
            if (value && !value.endsWith('.json') && !value.endsWith('.txt')) {
              return "Output file must end with .json or .txt";
            }
            return;
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

      maxPages: () =>
        p.text({
          message: "📄 Maximum pages to scrape per dork",
          placeholder: "1",
          defaultValue: "1",
          validate: (value) => {
            const num = parseInt(value);
            if (isNaN(num) || num < 1 || num > 10) {
              return "Must be a number between 1 and 10";
            }
          },
        }),

      minDelay: () =>
        p.text({
          message: "⏱️ Minimum delay between searches (seconds)",
          placeholder: "10",
          defaultValue: "10",
          validate: (value) => {
            const num = parseInt(value);
            if (isNaN(num) || num < 5 || num > 60) {
              return "Must be between 5 and 60 seconds";
            }
          },
        }),

      maxDelay: () =>
        p.text({
          message: "⏰ Maximum delay between searches (seconds)",
          placeholder: "20",
          defaultValue: "20",
          validate: (value) => {
            const num = parseInt(value);
            if (isNaN(num) || num < 5 || num > 120) {
              return "Must be between 5 and 120 seconds";
            }
          },
        }),

      // Extended delay option for automated queries
      extendedDelay: () =>
        p.confirm({
          message:
            "🕐 Enable extended automated delays (1-5 minutes between queries)?\n   Recommended for stealth dorking to avoid CAPTCHAs",
          initialValue: false,
        }),

      maxPause: () =>
        p.text({
          message: "⏸️ Maximum pause length (seconds)",
          placeholder: "19",
          defaultValue: "19",
          validate: (value) => {
            const num = parseInt(value);
            if (isNaN(num) || num < 5 || num > 60) {
              return "Must be between 5 and 60 seconds";
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

      disableWarmup: () =>
        p.confirm({
          message: "⏩ Disable browser warmup? (Skip warm-up session)",
          initialValue: false,
        }),

      disableMovements: () =>
        p.confirm({
          message: "🚀 Disable random mouse movements for faster execution?\n   Significantly speeds up searches but may reduce stealth",
          initialValue: false,
        }),

      // Proxy Settings
      autoProxy: () =>
        p.confirm({
          message: "🌍 Enable automatic proxy switching via ASOCKS?",
          initialValue: true,
        }),

      // Advanced Settings
      multiEngine: () =>
        p.confirm({
          message: "🔍 Enable multi-engine dorking?",
          initialValue: false,
        }),

      filteringType: () =>
        p.select({
          message: "🎯 Choose filtering type",
          options: [
            { value: 'dork', label: 'Dork based filtering', hint: 'Keep URLs that match dork patterns' },
            { value: 'parameter', label: 'Parameter filtering', hint: 'Allow any URL that contains parameters (e.g., ?id=)' }
          ],
          initialValue: 'dork',
        }),

      sqlInjectionTesting: () =>
        p.confirm({
          message: "🛡️ Enable SQL injection vulnerability testing?",
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

  // If multi-engine is enabled, ask for engine selection separately
  if (config.multiEngine) {
    config.engines = await p.select({
      message: "🔍 Select search engines to use",
      options: [
        { value: ['google', 'bing', 'duckduckgo'], label: 'All Browser Engines', hint: 'Use all available browser engines' },
        { value: ['google-api'], label: 'Google API Only', hint: 'Fast HTTP requests (no browser automation)' },
        { value: ['google', 'bing'], label: 'Google + Bing', hint: 'Most popular engines' },
        { value: ['google', 'duckduckgo'], label: 'Google + DuckDuckGo', hint: 'Privacy-focused option' },
        { value: ['google'], label: 'Google Only', hint: 'Default search engine' },
        { value: ['bing'], label: 'Bing Only', hint: 'Microsoft search engine' },
        { value: ['duckduckgo'], label: 'DuckDuckGo Only', hint: 'Privacy-focused engine' }
      ],
      initialValue: ['google']
    });
  } else {
    config.engines = ['google'];
  }

  // Debug: Log the raw config to see what we got
  console.log('\n🔍 Debug - Raw config:', {
    multiEngine: config.multiEngine,
    engines: config.engines
  });

  // Process the configuration
  const minDelay = parseInt(config.minDelay) || 10;
  const maxDelay = parseInt(config.maxDelay) || 45;

  // Validate delay range
  if (maxDelay <= minDelay) {
    p.cancel("Maximum delay must be greater than minimum delay");
    process.exit(1);
  }

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
    disableMovements: config.disableMovements,
    autoProxy: config.autoProxy,
    multiEngine: config.multiEngine,
    engines: config.engines || ['google'],
    filteringType: config.filteringType || 'dork',
    dorkFiltering: (config.filteringType || 'dork') === 'dork',
    sqlInjectionTesting: config.sqlInjectionTesting || false,
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
      `${resultsTable.toString()}`,
    {
      padding: 1,
      margin: 1,
      borderStyle: "round",
      borderColor: "green",
    }
  );

  console.log(resultBox);
}

// --- Placeholder stubs for previously existing helper functions (temporarily) ---
function displayFinalSummary() {}
function displayCaptchaDetected() {}
function displayProxySwitch() {}
function displayError(message, error = null) {
  console.error("CLI Error:", message, error?.message || "");
}
function createSpinner(text, color = "cyan") {
  return ora({ text, color, spinner: "dots" });
}
function displaySuccess(message) {
  console.log(chalk.green(message));
}
function displayWarning(message) {
  console.log(chalk.yellow(message));
}

function parseCommandLineArgs() {
  const program = new Command();
  program
    .option("-f, --fast", "Fast startup with default configuration", false)
    .option("-s, --server", "Run in server mode", false)
    .option("-p, --port <number>", "Port for server mode", parseInt)
    .option("-i, --interactive", "Run interactive mode", false)
    .option("--disable-movements", "Disable random mouse movements for faster execution", false)
    .option("--test-sql <file>", "Test SQL injection on URLs from file (e.g., results.txt, fast.txt)", false)
    .option("--concurrency <number>", "Number of concurrent workers for SQL testing", parseInt)
    .option("--level <level>", "Set log level (error, warn, info, debug)", "debug");
  program.parse();
  return program.opts();
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
  parseCommandLineArgs,
};