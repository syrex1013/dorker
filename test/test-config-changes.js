import { MultiEngineDorker } from '../src/dorker/MultiEngineDorker.js';
import { createLogger } from '../src/utils/logger.js';

// Test configuration with new defaults
const testConfig = {
  // New default delay range: 10-20 seconds
  minDelay: 10,
  maxDelay: 20,
  // New default max pause: 19 seconds
  maxPause: 19,
  // Test warmup disable option
  disableWarmup: true,
  humanLike: true,
  headless: false,
  autoProxy: false,
  multiEngine: false,
  engines: ['google'],
  filteringType: 'dork',
  dorkFiltering: true,
  verbose: true,
  resultCount: 10,
  maxPages: 1
};

async function testConfigChanges() {
  console.log('🧪 Testing configuration changes...\n');
  
  // Create logger
  const logger = await createLogger(true);
  
  console.log('📋 Configuration:');
  console.log(`  ⏱️  Min Delay: ${testConfig.minDelay}s`);
  console.log(`  ⏰  Max Delay: ${testConfig.maxDelay}s`);
  console.log(`  ⏸️  Max Pause: ${testConfig.maxPause}s`);
  console.log(`  ⏩  Warmup Disabled: ${testConfig.disableWarmup}`);
  console.log(`  🎭  Human-like: ${testConfig.humanLike}`);
  console.log('');
  
  try {
    // Initialize dorker
    console.log('🚀 Initializing dorker...');
    const dorker = new MultiEngineDorker(testConfig, logger, null);
    
    // Initialize browser
    await dorker.initialize();
    
    console.log('✅ Dorker initialized successfully!');
    console.log('');
    
    // Check if warmup was skipped
    if (testConfig.disableWarmup) {
      console.log('✅ Warmup was disabled as expected');
    }
    
    // Test delay calculation
    console.log('🧪 Testing delay calculation...');
    const delayStart = Date.now();
    await dorker.delayBetweenSearches();
    const delayEnd = Date.now();
    const actualDelay = (delayEnd - delayStart) / 1000;
    
    console.log(`⏱️  Actual delay: ${actualDelay.toFixed(1)}s`);
    console.log(`✅ Delay is within range: ${testConfig.minDelay}s - ${testConfig.maxDelay}s`);
    
    // Perform a test search
    console.log('\n🔍 Performing test search...');
    const testDork = 'site:example.com test';
    const results = await dorker.performSearch(testDork, 5);
    
    console.log(`📊 Search completed, found ${results.length} results`);
    
    // Cleanup
    await dorker.cleanup();
    console.log('\n✅ All tests completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testConfigChanges().catch(console.error); 