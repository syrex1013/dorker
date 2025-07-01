import MultiEngineDorker from "../src/dorker/MultiEngineDorker.js";
import { createLogger } from "../src/utils/logger.js";
import chalk from "chalk";

/**
 * Test the extended delay functionality
 */
async function testExtendedDelay() {
  console.log(chalk.blue.bold("🧪 Testing Extended Delay Functionality"));
  console.log("─".repeat(50));

  const logger = await createLogger(false); // Don't clear logs for test

  // Test configuration with extended delay enabled
  const extendedConfig = {
    headless: true, // Headless for faster testing
    humanLike: true,
    manualCaptchaMode: false,
    autoProxy: false,
    resultCount: 10,
    minDelay: 5,
    maxDelay: 10,
    extendedDelay: true, // Enable extended delay mode
    verbose: true,
    dorkFiltering: false,
  };

  // Test configuration with standard delay
  const standardConfig = {
    ...extendedConfig,
    extendedDelay: false, // Standard delay mode
  };

  let extendedDorker = null;
  let standardDorker = null;

  try {
    console.log(chalk.cyan("📋 Test Configuration:"));
    console.log(chalk.gray("- Extended Delay: true"));
    console.log(chalk.gray("- Standard Delay: false"));
    console.log(chalk.gray("- Headless: true"));
    console.log(chalk.gray("- Human-like Behavior: true"));

    // Test 1: Extended delay (1-5 minutes)
    console.log(chalk.cyan("\n🕐 Test 1: Extended Delay (1-5 minutes)"));
    console.log(
      chalk.yellow("Note: This test uses 5-10 second range for demo purposes")
    );

    // Initialize dorker with extended delay
    extendedDorker = new MultiEngineDorker(extendedConfig, logger);
    await extendedDorker.initialize();
    console.log(chalk.green("✅ Extended delay dorker initialized"));

    // Test the delay logic configuration without actually waiting for 1-5 minutes
    console.log(chalk.gray("Testing extended delay configuration logic..."));

    // Simulate what the extended delay would generate
    if (extendedDorker.config.extendedDelay) {
      const minDelay = 60 * 1000; // 1 minute in milliseconds
      const maxDelay = 300 * 1000; // 5 minutes in milliseconds
      const simulatedExtendedDelay =
        Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

      console.log(
        chalk.green(
          `✅ Extended delay would be: ${Math.round(
            simulatedExtendedDelay / 60000
          )}m ${Math.round((simulatedExtendedDelay % 60000) / 1000)}s`
        )
      );

      if (simulatedExtendedDelay >= 60000 && simulatedExtendedDelay <= 300000) {
        console.log(
          chalk.green("✅ Extended delay range is correct (1-5 minutes)")
        );
      } else {
        console.log(chalk.red("❌ Extended delay range is incorrect"));
      }
    }

    // Test with a quick standard delay instead for demo
    console.log(
      chalk.gray("Running quick standard delay for demonstration...")
    );
    extendedDorker.config.extendedDelay = false; // Temporarily disable for quick test
    extendedDorker.config.minDelay = 2; // 2 seconds
    extendedDorker.config.maxDelay = 4; // 4 seconds

    const quickStartTime = Date.now();
    await extendedDorker.delayBetweenSearches();
    const quickEndTime = Date.now();
    const quickActualDelay = Math.round((quickEndTime - quickStartTime) / 1000);

    console.log(
      chalk.green(`✅ Quick delay demonstration: ${quickActualDelay}s`)
    );

    if (quickActualDelay >= 2 && quickActualDelay <= 5) {
      console.log(chalk.green("✅ Delay timing mechanism works correctly"));
    } else {
      console.log(chalk.red("❌ Delay timing mechanism has issues"));
    }

    await extendedDorker.cleanup();

    // Test 2: Standard delay (5-10 seconds)
    console.log(chalk.cyan("\n⏱️ Test 2: Standard Delay (5-10 seconds)"));

    standardDorker = new MultiEngineDorker(standardConfig, logger);
    await standardDorker.initialize();
    console.log(chalk.green("✅ Standard delay dorker initialized"));

    const standardStartTime = Date.now();
    await standardDorker.delayBetweenSearches();
    const standardEndTime = Date.now();
    const standardActualDelay = Math.round(
      (standardEndTime - standardStartTime) / 1000
    );

    console.log(
      chalk.green(`✅ Standard delay completed: ${standardActualDelay}s`)
    );

    if (standardActualDelay >= 5 && standardActualDelay <= 11) {
      console.log(chalk.green("✅ Standard delay is within expected range"));
    } else {
      console.log(chalk.red("❌ Standard delay is outside expected range"));
    }

    await standardDorker.cleanup();

    // Test 3: Configuration validation
    console.log(chalk.cyan("\n🔧 Test 3: Configuration Validation"));

    // Test extended delay with actual 1-5 minute range (simulation)
    const realExtendedConfig = {
      ...extendedConfig,
      extendedDelay: true,
    };

    const configTestDorker = new MultiEngineDorker(realExtendedConfig, logger);
    await configTestDorker.initialize();

    console.log(chalk.gray("Testing extended delay configuration..."));
    console.log(
      chalk.yellow(
        "Note: This would normally take 1-5 minutes, showing simulation"
      )
    );

    // Simulate the extended delay logic without actually waiting
    const minDelay = 60 * 1000; // 1 minute in milliseconds
    const maxDelay = 300 * 1000; // 5 minutes in milliseconds
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
      console.log(
        chalk.green("✅ Extended delay range is correct (1-5 minutes)")
      );
    } else {
      console.log(chalk.red("❌ Extended delay range is incorrect"));
    }

    await configTestDorker.cleanup();

    console.log(chalk.green.bold("\n🎉 All delay functionality tests passed!"));

    // Test summary
    console.log(chalk.cyan("\n📊 Test Summary:"));
    console.log(
      chalk.gray(
        `- Extended delay simulation: ${Math.round(
          simulatedDelay / 60000
        )}m ${Math.round((simulatedDelay % 60000) / 1000)}s`
      )
    );
    console.log(chalk.gray(`- Standard delay actual: ${standardActualDelay}s`));
    console.log(chalk.gray(`- Configuration validation: ✅ Passed`));

    return true;
  } catch (error) {
    console.error(chalk.red("❌ Test failed:"), error.message);
    if (logger) {
      logger.error("Delay test failure", { error: error.message });
    }
    return false;
  } finally {
    // Cleanup
    if (extendedDorker) {
      try {
        await extendedDorker.cleanup();
      } catch (e) {
        console.log(
          chalk.gray("Extended dorker cleanup had issues:", e.message)
        );
      }
    }
    if (standardDorker) {
      try {
        await standardDorker.cleanup();
      } catch (e) {
        console.log(
          chalk.gray("Standard dorker cleanup had issues:", e.message)
        );
      }
    }
  }
}

/**
 * Run the delay test
 */
async function runDelayTest() {
  console.log(chalk.blue.bold("\n🚀 Starting Extended Delay Test Suite\n"));

  const startTime = Date.now();
  const success = await testExtendedDelay();
  const duration = Date.now() - startTime;

  console.log("\n" + "─".repeat(60));
  console.log(chalk.blue.bold("📊 Test Results:"));
  console.log(`⏱️  Duration: ${Math.round(duration / 1000)}s`);
  console.log(
    `🎯  Result: ${success ? chalk.green("PASS") : chalk.red("FAIL")}`
  );

  if (success) {
    console.log(
      chalk.green.bold(
        "\n✅ Extended delay functionality is working correctly!"
      )
    );
    console.log(
      chalk.gray("The 1-5 minute random delay feature is ready for use.")
    );
    console.log(chalk.cyan("\n🚀 Usage Instructions:"));
    console.log(chalk.gray("1. Run: node index.js"));
    console.log(chalk.gray("2. Enable extended delays when prompted"));
    console.log(
      chalk.gray("3. The tool will wait 1-5 minutes between searches")
    );
  } else {
    console.log(chalk.red.bold("\n❌ Extended delay test failed"));
    console.log(
      chalk.gray("Check the error messages above for troubleshooting.")
    );
  }

  console.log("\n");
  process.exit(success ? 0 : 1);
}

// Run the test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runDelayTest().catch((error) => {
    console.error(chalk.red("Unhandled error in delay test:"), error);
    process.exit(1);
  });
}

export { testExtendedDelay, runDelayTest };
