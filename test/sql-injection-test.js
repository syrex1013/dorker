import { SQLInjectionTester } from '../src/sql/sqlInjectionTester.js';
import { createLogger } from '../src/utils/logger.js';

/**
 * Test the SQL injection testing functionality
 */
async function testSQLInjectionTester() {
    console.log('🧪 Testing SQL injection functionality...\n');
    
    const config = {
        headless: true,
        sqlTestDelay: 500 // Faster testing for demo
    };
    
    const logger = await createLogger(false);
    
    // Create tester instance
    const sqlTester = new SQLInjectionTester(config, logger);
    
    try {
        // Initialize tester
        await sqlTester.initialize();
        console.log('✅ SQL injection tester initialized successfully\n');
        
        // Test URLs (these are hypothetical test URLs)
        const testUrls = [
            'https://example.com/page.php?id=1',
            'https://example.com/search.php?q=test&category=books',
            'https://example.com/login.php',
            'https://example.com/product.php?id=123&user=admin'
        ];
        
        console.log(`🔍 Testing ${testUrls.length} URLs for SQL injection vulnerabilities...\n`);
        
        // Test each URL
        for (const url of testUrls) {
            console.log(`Testing: ${url}`);
            
            // Note: This will try to test but may fail due to network/site issues
            // The real test is to verify the module loads and functions work
            try {
                const result = await sqlTester.testUrl(url);
                console.log(`  Result: ${result.vulnerable ? '🚨 VULNERABLE' : '✅ Safe'}`);
                if (result.error) {
                    console.log(`  Error: ${result.error}`);
                }
            } catch (error) {
                console.log(`  Error testing URL: ${error.message}`);
            }
        }
        
        // Get statistics
        const stats = sqlTester.getStats();
        console.log('\n📊 SQL injection testing statistics:');
        console.log(`  Total payload types: ${stats.payloadTypes.length}`);
        console.log(`  Total payloads: ${stats.totalPayloads}`);
        console.log(`  Vulnerable URLs found: ${stats.totalVulnerableUrls}`);
        
        // Test payload types
        console.log('\n🎯 Available payload types:');
        stats.payloadTypes.forEach(type => {
            console.log(`  - ${type}`);
        });
        
        // Cleanup
        await sqlTester.cleanup();
        console.log('\n✅ SQL injection tester cleanup completed');
        
    } catch (error) {
        console.error('❌ SQL injection tester test failed:', error.message);
        process.exit(1);
    }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
    testSQLInjectionTester()
        .then(() => {
            console.log('\n🎉 SQL injection testing functionality verified successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Test failed:', error.message);
            process.exit(1);
        });
}

export { testSQLInjectionTester }; 