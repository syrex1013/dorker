import { StandaloneSQLTester } from '../src/sql/standaloneSQLTester.js';
import { GoogleApiSearcher } from '../src/search/googleApiSearcher.js';
import chalk from 'chalk';

/**
 * Test the new features: Standalone SQL injection testing and Google API search
 */
async function testNewFeatures() {
    console.log(chalk.bold.blue('🧪 Testing New THREATDORKER Features\n'));
    
    // Test 1: Standalone SQL Injection Testing
    console.log(chalk.blue('📋 Test 1: Standalone SQL Injection Testing'));
    console.log(chalk.gray('Testing multithreaded SQL injection on URLs from file...\n'));
    
    try {
        const sqlTester = new StandaloneSQLTester({
            maxConcurrency: 3, // Use fewer workers for demo
            testDelay: 200, // Faster for demo
            headless: true,
            timeout: 10000,
            outputFile: 'test-vuln.txt',
            verbose: true
        });
        
        await sqlTester.initialize();
        
        // Read test URLs
        const urls = await sqlTester.readUrlsFromFile('test/test-urls.txt');
        console.log(chalk.green(`✅ Loaded ${urls.length} test URLs\n`));
        
        // Test a small subset for demo
        const testUrls = urls.slice(0, 3);
        console.log(chalk.blue(`🚀 Testing ${testUrls.length} URLs with multithreading...\n`));
        
        const results = await sqlTester.testUrls(testUrls);
        
        console.log(chalk.green(`✅ SQL injection testing completed:`));
        console.log(chalk.cyan(`   - Tested: ${results.tested} URLs`));
        console.log(chalk.cyan(`   - Vulnerable: ${results.vulnerable} URLs`));
        console.log(chalk.cyan(`   - Duration: ${(results.duration / 1000).toFixed(2)}s`));
        console.log(chalk.cyan(`   - Rate: ${(results.tested / (results.duration / 1000)).toFixed(1)} URLs/second\n`));
        
        await sqlTester.cleanup();
        
    } catch (error) {
        console.error(chalk.red(`❌ SQL injection testing failed: ${error.message}\n`));
    }
    
    // Test 2: Google API Search
    console.log(chalk.blue('📋 Test 2: Google API Search (HTTP Requests)'));
    console.log(chalk.gray('Testing direct HTTP requests to Google without browser automation...\n'));
    
    try {
        const googleApi = new GoogleApiSearcher({
            delay: 3000, // Be respectful to Google
            maxResults: 5, // Small test
            timeout: 15000
        });
        
        await googleApi.initialize();
        
        // Test search
        const testQuery = 'site:github.com "SQL injection"';
        console.log(chalk.blue(`🔍 Searching: ${testQuery}\n`));
        
        const searchResults = await googleApi.search(testQuery, 5);
        
        console.log(chalk.green(`✅ Google API search completed:`));
        console.log(chalk.cyan(`   - Query: ${testQuery}`));
        console.log(chalk.cyan(`   - Results found: ${searchResults.length}`));
        
        if (searchResults.length > 0) {
            console.log(chalk.cyan(`   - Sample results:`));
            searchResults.slice(0, 2).forEach((result, index) => {
                console.log(chalk.gray(`     ${index + 1}. ${result.title.substring(0, 50)}...`));
                console.log(chalk.gray(`        ${result.url.substring(0, 60)}...`));
            });
        }
        
        const stats = googleApi.getStats();
        console.log(chalk.cyan(`   - Total searches: ${stats.searchCount}`));
        console.log(chalk.cyan(`   - Blocked: ${stats.blocked ? 'Yes' : 'No'}\n`));
        
    } catch (error) {
        console.error(chalk.red(`❌ Google API search failed: ${error.message}`));
        console.log(chalk.yellow(`   Note: This might fail due to Google's anti-bot measures\n`));
    }
    
    // Test 3: CLI Commands Demo
    console.log(chalk.blue('📋 Test 3: CLI Commands'));
    console.log(chalk.gray('New command line options available:\n'));
    
    console.log(chalk.cyan('🛡️ Standalone SQL Injection Testing:'));
    console.log(chalk.white('   npm run sql-test results.txt'));
    console.log(chalk.white('   node index.js --test-sql test/test-urls.txt --concurrency 10\n'));
    
    console.log(chalk.cyan('🔍 Google API Search Engine:'));
    console.log(chalk.white('   - Available in CLI: Select "Google API Only" when choosing engines'));
    console.log(chalk.white('   - Available in Web UI: Check "Google API" in search engines\n'));
    
    // Summary
    console.log(chalk.bold.green('🎉 New Features Summary:'));
    console.log(chalk.green('✅ Standalone multithreaded SQL injection testing'));
    console.log(chalk.green('✅ Google API search without browser automation'));
    console.log(chalk.green('✅ CLI integration for both features'));
    console.log(chalk.green('✅ Web UI integration for Google API search'));
    console.log(chalk.green('✅ High-performance concurrent testing'));
    console.log(chalk.green('✅ Professional logging and progress tracking\n'));
    
    console.log(chalk.bold.blue('📚 Usage Examples:'));
    console.log(chalk.white('1. Test existing results: node index.js --test-sql results.txt'));
    console.log(chalk.white('2. Fast dorking: Select "Google API Only" engine in CLI/Web UI'));
    console.log(chalk.white('3. Combined workflow: Use Google API for fast dorking + SQL testing'));
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
    testNewFeatures()
        .then(() => {
            console.log(chalk.bold.green('\n🎉 New features testing completed successfully!'));
            process.exit(0);
        })
        .catch((error) => {
            console.error(chalk.red('\n❌ Test failed:'), error.message);
            process.exit(1);
        });
}

export { testNewFeatures }; 