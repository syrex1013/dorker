import { SQLInjectionTester } from './src/sql/sqlInjectionTester.js';
import { createLogger } from './src/utils/logger.js';
import chalk from 'chalk';

async function testImprovedSQLInjection() {
    console.log(chalk.cyan.bold('\n🔍 Testing Improved SQL Injection Detection with:'));
    console.log(chalk.yellow('  ✓ Tamper techniques for WAF bypass'));
    console.log(chalk.yellow('  ✓ Enhanced database extraction methods'));
    console.log(chalk.yellow('  ✓ Relevant response logging (max 5 lines)'));
    console.log(chalk.yellow('  ✓ Fallback methods when one fails\n'));
    
    const logger = await createLogger({
        outputFile: 'test-results.txt',
        verbose: true
    });
    
    const tester = new SQLInjectionTester({
        timeout: 30000,
        verbose: true,
        delay: 100
    }, logger);
    
    // Test URLs that might have WAF protection
    const testUrls = [
        'http://testphp.vulnweb.com/artists.php?artist=1',
        'http://testphp.vulnweb.com/listproducts.php?cat=1',
        'http://testphp.vulnweb.com/showimage.php?file=1'
    ];
    
    console.log(chalk.green('Testing with tamper techniques enabled...\n'));
    
    for (const url of testUrls) {
        console.log(chalk.blue(`\n➤ Testing: ${url}`));
        
        try {
            const results = await tester.testUrls([url]);
            const result = results[0] || {};
            
            if (result.vulnerable) {
                console.log(chalk.red.bold('✗ VULNERABLE!'));
                
                if (result.database) {
                    console.log(chalk.yellow('\n📊 Extracted Database Info:'));
                    console.log(chalk.white(`  Type: ${result.database.type || 'Unknown'}`));
                    console.log(chalk.white(`  Version: ${result.database.version || 'Unknown'}`));
                    console.log(chalk.white(`  Name: ${result.database.name || 'Unknown'}`));
                    
                    if (result.database.databases) {
                        console.log(chalk.white(`  Databases: ${result.database.databases.join(', ')}`));
                    }
                }
                
                console.log(chalk.yellow('\n🔧 Vulnerabilities found:'));
                result.vulnerabilities.forEach((vuln, idx) => {
                    console.log(chalk.white(`  ${idx + 1}. Type: ${vuln.type}`));
                    console.log(chalk.white(`     Parameter: ${vuln.parameter}`));
                    console.log(chalk.white(`     Evidence: ${vuln.evidence}`));
                });
            } else {
                console.log(chalk.green('✓ No vulnerabilities found'));
            }
            
        } catch (error) {
            console.log(chalk.red(`✗ Error testing URL: ${error.message}`));
        }
    }
    
    // Display stats
    console.log(chalk.cyan('\n\n📈 Test Statistics:'));
    console.log(chalk.white(`  Total URLs tested: ${tester.stats.testedUrls}`));
    console.log(chalk.white(`  Total requests made: ${tester.stats.totalRequests}`));
    console.log(chalk.white(`  Vulnerable URLs found: ${tester.stats.totalVulnerableUrls}`));
    console.log(chalk.white(`  Confirmed with DB extraction: ${tester.stats.confirmedVulnerableUrls}`));
    
    console.log(chalk.gray('\n✅ Check logs/sql/ for detailed extraction logs with relevant response snippets\n'));
}

// Run the test
testImprovedSQLInjection().catch(console.error); 