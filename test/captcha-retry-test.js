import { MultiEngineDorker } from '../src/dorker/MultiEngineDorker.js';
import winston from 'winston';

// Create a simple logger for testing
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
      return `${timestamp} [${level.toUpperCase()}] ${message} ${metaStr}`;
    })
  ),
  transports: [
    new winston.transports.Console()
  ]
});

// Test configuration
const testConfig = {
  headless: false, // Set to true for automated testing
  autoProxy: true, // Enable auto proxy for captcha retry
  humanLike: true,
  maxPages: 2, // Test pagination
  delay: 5,
  maxDelay: 10,
  dorkFiltering: true
};

// Test dorks
const testDorks = [
  'site:example.com inurl:admin',
  'site:test.com filetype:pdf'
];

// Test engines - process all dorks for each engine before moving to next
const testEngines = ['google', 'bing'];

async function runTest() {
  logger.info('Starting captcha retry test...');
  
  const dorker = new MultiEngineDorker(testConfig, logger);
  
  try {
    // Initialize the dorker
    await dorker.initialize();
    logger.info('Dorker initialized successfully');
    
    // Perform batch search - this will:
    // 1. Complete all dorks and all pages for 'google' first
    // 2. Then complete all dorks and all pages for 'bing'
    // 3. If captcha fails, it will generate new proxy, restart browser, and retry the same engine
    const results = await dorker.performBatchSearch(testDorks, 30, testEngines);
    
    logger.info(`Total results found: ${results.length}`);
    
    // Log results by engine
    const resultsByEngine = {};
    testEngines.forEach(engine => {
      resultsByEngine[engine] = results.filter(r => r.engine === engine);
    });
    
    for (const engine of testEngines) {
      logger.info(`Results from ${engine}: ${resultsByEngine[engine].length}`);
    }
    
    // Cleanup
    await dorker.cleanup();
    logger.info('Test completed successfully');
    
  } catch (error) {
    logger.error('Test failed:', { error: error.message, stack: error.stack });
    await dorker.cleanup();
    process.exit(1);
  }
}

// Run the test
runTest().catch(error => {
  logger.error('Unhandled error:', error);
  process.exit(1);
}); 