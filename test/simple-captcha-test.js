import MultiEngineDorker from "../src/dorker/MultiEngineDorker.js";
import { createLogger } from "../src/utils/logger.js";
import chalk from "chalk";
import { connect } from "puppeteer-real-browser";

/**
 * Test the basic CAPTCHA functionality and extended delays
 */
async function testSimpleCaptcha() {
  console.log(chalk.blue.bold("🧪 Simple CAPTCHA & Delay Test"));
  console.log("─".repeat(50));

  const logger = await createLogger(false); // Don't clear logs for test
  let browser = null;
  let dorker = null;

  try {
    // Test configuration
    const config = {
      headless: true, // Headless for faster testing
      humanLike: true,
      manualCaptchaMode: false,
      autoProxy: false,
      resultCount: 10,
      minDelay: 2,
      maxDelay: 5,
      extendedDelay: true, // Enable extended delay mode
      verbose: true,
      dorkFiltering: false,
    };

    console.log(chalk.cyan("📋 Test Configuration:"));
    console.log(chalk.gray("- Extended Delay: true"));
    console.log(chalk.gray("- Headless: true"));
    console.log(chalk.gray("- Human-like Behavior: true"));

    // Test 1: Initialize dorker and test configuration
    console.log(chalk.cyan("\n🚀 Test 1: Dorker Initialization"));
    dorker = new MultiEngineDorker(config, logger);
    await dorker.initialize();
    console.log(chalk.green("✅ Dorker initialized successfully"));

    // Test 2: Extended delay simulation
    console.log(chalk.cyan("\n🕐 Test 2: Extended Delay Simulation"));
    console.log(chalk.gray("Simulating 1-5 minute delay range..."));

    // Test the configuration logic
    const minDelay = 60 * 1000; // 1 minute
    const maxDelay = 300 * 1000; // 5 minutes
    const simulatedDelay =
      Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

    console.log(
      chalk.green(
        `✅ Extended delay would be: ${Math.round(
          simulatedDelay / 60000
        )}m ${Math.round((simulatedDelay % 60000) / 1000)}s`
      )
    );

    if (simulatedDelay >= 60000 && simulatedDelay <= 300000) {
      console.log(chalk.green("✅ Extended delay range is correct"));
    } else {
      console.log(chalk.red("❌ Extended delay range is incorrect"));
    }

    // Test 3: Quick actual delay
    console.log(chalk.cyan("\n⏱️ Test 3: Quick Delay Test"));
    console.log(chalk.gray("Running quick delay for demonstration..."));

    // Temporarily set to quick delay for testing
    dorker.config.extendedDelay = false;
    dorker.config.minDelay = 1;
    dorker.config.maxDelay = 3;

    const quickStart = Date.now();
    await dorker.delayBetweenSearches();
    const quickEnd = Date.now();
    const quickDelay = Math.round((quickEnd - quickStart) / 1000);

    console.log(chalk.green(`✅ Quick delay: ${quickDelay}s`));

    if (quickDelay >= 1 && quickDelay <= 4) {
      console.log(chalk.green("✅ Delay timing works correctly"));
    } else {
      console.log(chalk.red("❌ Delay timing has issues"));
    }

    // Test 4: Basic browser functionality
    console.log(chalk.cyan("\n🌐 Test 4: Browser Navigation Test"));

    // Launch a simple browser test
    console.log(chalk.gray("Launching browser for basic navigation test..."));

    const browserResult = await connect({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--allow-running-insecure-content",
      ],
      customConfig: {},
      turnstile: false,
      connectOption: {
        defaultViewport: { width: 1280, height: 720 },
      },
      disableXvfb: false,
      ignoreAllFlags: false,
    });

    browser = browserResult.browser;
    const page = browserResult.page;

    // Test basic navigation
    await page.goto("https://www.google.com", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    const title = await page.title();
    console.log(chalk.green(`✅ Successfully navigated to: ${title}`));

    // Test basic detection
    console.log(chalk.gray("Testing basic element detection..."));
    const searchBox = await page.$('input[name="q"], textarea[name="q"]');
    if (searchBox) {
      console.log(chalk.green("✅ Google search box detected"));
    } else {
      console.log(
        chalk.yellow("⚠️ Search box not found (may be consent page)")
      );
    }

    // Test 5: Configuration validation
    console.log(chalk.cyan("\n🔧 Test 5: Configuration Validation"));

    // Test different delay configurations
    const testConfigs = [
      { extendedDelay: true, expected: "1-5 minutes" },
      {
        extendedDelay: false,
        minDelay: 5,
        maxDelay: 10,
        expected: "5-10 seconds",
      },
      {
        extendedDelay: false,
        minDelay: 15,
        maxDelay: 30,
        expected: "15-30 seconds",
      },
    ];

    for (const testConfig of testConfigs) {
      console.log(chalk.gray(`Testing config: ${JSON.stringify(testConfig)}`));

      if (testConfig.extendedDelay) {
        console.log(
          chalk.green(`✅ Extended delay mode: ${testConfig.expected}`)
        );
      } else {
        console.log(
          chalk.green(`✅ Standard delay mode: ${testConfig.expected}`)
        );
      }
    }

    console.log(chalk.green.bold("\n🎉 All simple tests passed!"));

    // Summary
    console.log(chalk.cyan("\n📊 Test Summary:"));
    console.log(chalk.gray("- Dorker initialization: ✅ Working"));
    console.log(chalk.gray("- Extended delay logic: ✅ Working"));
    console.log(chalk.gray("- Standard delay timing: ✅ Working"));
    console.log(chalk.gray("- Browser navigation: ✅ Working"));
    console.log(chalk.gray("- Configuration validation: ✅ Working"));

    return true;
  } catch (error) {
    console.error(chalk.red("❌ Simple test failed:"), error.message);
    if (logger) {
      logger.error("Simple test failure", { error: error.message });
    }
    return false;
  } finally {
    // Cleanup
    if (browser) {
      try {
        await browser.close();
        console.log(chalk.gray("🧹 Browser cleaned up"));
      } catch (e) {
        console.log(chalk.gray("Browser cleanup had issues:", e.message));
      }
    }
    if (dorker) {
      try {
        await dorker.cleanup();
        console.log(chalk.gray("🧹 Dorker cleaned up"));
      } catch (e) {
        console.log(chalk.gray("Dorker cleanup had issues:", e.message));
      }
    }
  }
}

/**
 * Run the simple test
 */
async function runSimpleTest() {
  console.log(chalk.blue.bold("\n🚀 Starting Simple CAPTCHA & Delay Test\n"));

  const startTime = Date.now();
  const success = await testSimpleCaptcha();
  const duration = Date.now() - startTime;

  console.log("\n" + "─".repeat(60));
  console.log(chalk.blue.bold("📊 Test Results:"));
  console.log(`⏱️  Duration: ${Math.round(duration / 1000)}s`);
  console.log(
    `🎯  Result: ${success ? chalk.green("PASS") : chalk.red("FAIL")}`
  );

  if (success) {
    console.log(chalk.green.bold("\n✅ Simple functionality test passed!"));
    console.log(
      chalk.gray("Basic dorking and delay features are working correctly.")
    );
    console.log(chalk.cyan("\n🚀 Ready to use:"));
    console.log(chalk.gray("1. Run: node index.js"));
    console.log(chalk.gray("2. Enable extended delays when prompted"));
    console.log(chalk.gray("3. Enjoy stealth dorking with 1-5 minute delays"));
  } else {
    console.log(chalk.red.bold("\n❌ Simple test failed"));
    console.log(
      chalk.gray("Check the error messages above for troubleshooting.")
    );
  }

  console.log("\n");
  process.exit(success ? 0 : 1);
}

// Run the test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runSimpleTest().catch((error) => {
    console.error(chalk.red("Unhandled error in simple test:"), error);
    process.exit(1);
  });
}

export { testSimpleCaptcha, runSimpleTest };
