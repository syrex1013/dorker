import fs from 'fs/promises';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createLogger } from '../utils/logger.js';
import { appendToFile, resolveOutputPath } from '../utils/fileOperations.js';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Standalone SQL Injection Tester
 * Tests URLs from files using multithreading for high performance
 */
export class StandaloneSQLTester {
    constructor(config = {}) {
        this.config = {
            maxConcurrency: config.maxConcurrency || 10,
            testDelay: config.testDelay || 500,
            headless: config.headless !== undefined ? config.headless : true,
            timeout: config.timeout || 30000,
            outputFile: config.outputFile || resolveOutputPath('vuln.txt'),
            verbose: config.verbose || false,
            logLevel: config.logLevel || 'debug',
            ...config
        };
        
        this.logger = null;
        this.results = {
            total: 0,
            tested: 0,
            vulnerable: 0,
            errors: 0,
            startTime: null,
            endTime: null
        };
        
        this.workers = [];
        this.activeWorkers = 0;
    }
    
    /**
     * Initialize the standalone tester
     */
    async initialize() {
        try {
            this.logger = await createLogger(false, true, this.config.logLevel);
            this.logger.info('Initializing standalone SQL injection tester');
            
            // Clear previous results file
            try {
                await fs.mkdir(dirname(this.config.outputFile), { recursive: true });
                await fs.writeFile(this.config.outputFile, '');
                this.logger.info(`Cleared previous results from ${this.config.outputFile}`);
            } catch (error) {
                this.logger.warn(`Could not clear ${this.config.outputFile}: ${error.message}`);
            }
            
            console.log(chalk.blue('🛡️ Standalone SQL Injection Tester Initialized'));
            console.log(chalk.gray(`Max Concurrency: ${this.config.maxConcurrency}`));
            console.log(chalk.gray(`Output File: ${this.config.outputFile}`));
            console.log(chalk.gray(`Test Delay: ${this.config.testDelay}ms\n`));
            
            return true;
        } catch (error) {
            console.error(chalk.red('❌ Failed to initialize SQL injection tester'), error.message);
            throw error;
        }
    }
    
    /**
     * Read URLs from file
     */
    async readUrlsFromFile(filePath) {
        try {
            console.log(chalk.blue(`📁 Reading URLs from ${filePath}...`));
            
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n').filter(line => line.trim());
            
            let urls = [];
            
            // Handle different file formats
            for (const line of lines) {
                try {
                    // Try parsing as JSON first (for results.json format)
                    const jsonData = JSON.parse(line);
                    if (jsonData.url) {
                        urls.push(jsonData.url);
                    } else if (Array.isArray(jsonData)) {
                        jsonData.forEach(item => {
                            if (item.url) urls.push(item.url);
                        });
                    }
                } catch (e) {
                    // Not JSON, treat as plain URL
                    const trimmed = line.trim();
                    if (trimmed.startsWith('http')) {
                        urls.push(trimmed);
                    }
                }
            }
            
            // Remove duplicates and filter URLs with parameters
            urls = [...new Set(urls)].filter(url => {
                try {
                    const urlObj = new URL(url);
                    return urlObj.search && urlObj.search.length > 1; // Has parameters
                } catch (e) {
                    return false;
                }
            });
            
            console.log(chalk.green(`✅ Found ${urls.length} unique URLs with parameters`));
            this.logger?.info(`Loaded ${urls.length} URLs from ${filePath}`);
            
            return urls;
            
        } catch (error) {
            console.error(chalk.red(`❌ Failed to read URLs from ${filePath}:`), error.message);
            throw error;
        }
    }
    
    /**
     * Test URLs using worker threads for concurrency
     */
    async testUrls(urls) {
        try {
            this.results.total = urls.length;
            this.results.startTime = Date.now();
            
            console.log(chalk.blue(`🚀 Starting concurrent SQL injection testing of ${urls.length} URLs...`));
            console.log(chalk.gray(`Using ${this.config.maxConcurrency} concurrent workers\n`));
            
            // Split URLs into chunks for workers
            const chunks = this.chunkArray(urls, Math.ceil(urls.length / this.config.maxConcurrency));
            
            // Create promises for each worker
            const workerPromises = chunks.map((chunk, index) => 
                this.createWorker(chunk, index)
            );
            
            // Wait for all workers to complete
            const workerResults = await Promise.all(workerPromises);
            const allResults = workerResults.flat();

            // Aggregate results
            this.results.tested = allResults.length;
            const vulnerableResults = allResults.filter(result => result.vulnerable);
            this.results.vulnerable = vulnerableResults.length;
            this.results.errors = allResults.filter(result => result.error).length;
            this.results.endTime = Date.now();
            this.vulnerableUrls = vulnerableResults;

            // Save vulnerable URLs
            for (const result of vulnerableResults) {
                await this.saveVulnerableUrl(result.url);
            }

            this.displayResults();
            return {
                total: this.results.total,
                tested: this.results.tested,
                vulnerable: this.results.vulnerable,
                errors: this.results.errors,
                duration: this.results.endTime - this.results.startTime,
                results: allResults
            };
            
        } catch (error) {
            console.error(chalk.red('❌ Failed to test URLs:'), error.message);
            throw error;
        }
    }
    
    /**
     * Create and manage a worker thread
     */
    async createWorker(urls, workerId) {
        return new Promise((resolve, reject) => {
            const workerData = {
                urls,
                config: this.config,
                workerId
            };
            
            const worker = new Worker(join(__dirname, 'sqlWorker.js'), {
                workerData
            });
            
            this.workers.push(worker);
            this.activeWorkers++;
            
            const results = [];
            
            worker.on('message', (message) => {
                switch (message.type) {
                    case 'progress':
                        // Handle new progress message format
                        this.processWorkerResult(message.result);
                        results.push(message.result);
                        break;
                    case 'complete':
                        this.activeWorkers--;
                        resolve(message.results || results);
                        break;
                    case 'error':
                        this.activeWorkers--;
                        reject(new Error(message.message || message.error));
                        break;
                    case 'info':
                        // Log worker information messages
                        this.logger?.info(message.message);
                        if (this.config.verbose) {
                            console.log(chalk.gray(`ℹ️  ${message.message}`));
                        }
                        break;
                }
            });
            
            worker.on('error', (error) => {
                this.activeWorkers--;
                reject(error);
            });
            
            worker.on('exit', (code) => {
                if (code !== 0) {
                    this.activeWorkers--;
                    reject(new Error(`Worker stopped with exit code ${code}`));
                }
            });
        });
    }
    
    /**
     * Process worker results
     */
    processWorkerResult(data) {
        this.results.tested++;
        
        if (data.vulnerable) {
            this.results.vulnerable++;
            
            // Store vulnerable result for statistics
            if (!this.vulnerableUrls) {
                this.vulnerableUrls = [];
            }
            this.vulnerableUrls.push(data);
            
            // Save only the URL to vuln.txt
            this.saveVulnerableUrl(data.url);
            
            // Check if this is a confirmed vulnerability
            const isConfirmed = data.database && data.database.name && data.database.version;
            
            // Display detailed vulnerability information
            if (isConfirmed) {
                console.log(chalk.green.bold(`\n✅ CONFIRMED SQL INJECTION FOUND:`));
            } else {
                console.log(chalk.yellow.bold(`\n⚠️ POTENTIAL SQL INJECTION FOUND:`));
            }
            console.log(chalk.red(`   URL: ${data.url}`));
            
            // Display each confirmed vulnerability
            if (data.vulnerabilities && data.vulnerabilities.length > 0) {
                data.vulnerabilities.forEach((vuln, index) => {
                    console.log(chalk.yellow(`   \n📋 Vulnerability ${index + 1}:`));
                    console.log(chalk.cyan(`      Type: ${vuln.type.toUpperCase()}`));
                    console.log(chalk.cyan(`      DB Type: ${vuln.database?.type || 'Unknown'}`));
                    console.log(chalk.cyan(`      DB Version: ${vuln.database?.version || 'Unknown'}`));
                    console.log(chalk.cyan(`      DB Name: ${vuln.database?.name || 'Unknown'}`));
                    
                    // Display all databases if available
                    if (vuln.database?.databases && vuln.database.databases.length > 0) {
                        console.log(chalk.cyan(`      All Databases: ${vuln.database.databases.join(', ')}`));
                    }
                    console.log(chalk.cyan(`      Parameter: ${vuln.parameter}`));
                    console.log(chalk.magenta(`      Payload: ${vuln.payload}`));
                    console.log(chalk.gray(`      Test URL: ${vuln.url}`));
                    
                    if (vuln.evidence) {
                        console.log(chalk.yellow(`      Evidence: ${vuln.evidence.substring(0, 100)}${vuln.evidence.length > 100 ? '...' : ''}`));
                    }
                    
                    if (vuln.responseTime) {
                        console.log(chalk.gray(`      Response Time: ${vuln.responseTime}ms`));
                    }
                });
            }
            
            console.log(chalk.red(`   Total Vulnerabilities: ${data.vulnerabilities?.length || 1}`));
            console.log(chalk.red(`   Worker ID: ${data.workerId}`));
            console.log(chalk.green.bold(`   📝 Saved to ${this.config.outputFile}\n`));
            
        } else if (data.error) {
            this.results.errors++;
            // Log all errors to file only - no CLI output
            this.logger?.error(`URL testing failed`, { 
                url: data.url, 
                error: data.error,
                workerId: data.workerId 
            });
        }
        
        this.updateProgress(data);
    }
    
    /**
     * Update progress display
     */
    updateProgress(data) {
        const percentage = Math.round((this.results.tested / this.results.total) * 100);
        const elapsed = Date.now() - this.results.startTime;
        const rate = elapsed > 0 ? this.results.tested / (elapsed / 1000) : 0;
        
        // Count confirmed vulnerabilities (with DB name AND version)
        const confirmedCount = this.vulnerableUrls?.filter(r => 
            r.database && r.database.name && r.database.version
        ).length || 0;
        
        // Count potential vulnerabilities (vulnerable but no DB details)
        const potentialCount = this.results.vulnerable - confirmedCount;
        
        // Update CLI output live every time; overwrite the same line for cleanliness
        const progressMsg = `📊 Progress: ${this.results.tested}/${this.results.total} (${percentage}%) | Vulnerable: ${this.results.vulnerable} (✅${confirmedCount} ⚠️${potentialCount}) | Errors: ${this.results.errors} | Rate: ${rate.toFixed(1)}/s`;
        try {
            if (process.stdout.isTTY) {
                process.stdout.cursorTo(0);
                process.stdout.write(chalk.cyan(progressMsg));
                process.stdout.clearLine(1);
            } else if (this.results.tested % 20 === 0 || data.vulnerable) {
                // Fallback for non-TTY environments
                console.log(chalk.cyan(progressMsg));
            }
        } catch {
            // If TTY not available, fallback to console.log occasionally
            if (this.results.tested % 20 === 0 || data.vulnerable) {
                console.log(chalk.cyan(progressMsg));
            }
        }
        
        // Log progress internally regardless of display
        if (this.results.tested % 20 === 0 || data.vulnerable) {
            this.logger?.info(`SQL injection testing progress ${this.results.tested}/${this.results.total} (${percentage}%) | Vulnerable: ${this.results.vulnerable} (Confirmed: ${confirmedCount}, Potential: ${potentialCount}) | Errors: ${this.results.errors} | Rate: ${rate.toFixed(1)}/s`);
        }
    }
    
    /**
     * Save vulnerable URL to file (only URL, no additional data)
     */
    async saveVulnerableUrl(url) {
        try {
            // Save only the URL, one per line, no additional text
            await appendToFile(this.config.outputFile, url + '\n');
            
            this.logger.info(`Vulnerable URL saved to ${this.config.outputFile}: ${url}`);
            
        } catch (error) {
            this.logger.error('Error saving vulnerable URL', { error: error.message });
        }
    }
    
    /**
     * Display final results
     */
    displayResults() {
        const duration = this.results.endTime - this.results.startTime;
        const rate = this.results.tested / (duration / 1000);
        
        // Move to a new line after the progress bar
        if (process.stdout.isTTY) {
            process.stdout.write('\n');
        }
        
        // Calculate vulnerability statistics
        const vulnerabilityStats = this.calculateVulnerabilityStats();
        
        console.log('\n' + '='.repeat(70));
        console.log(chalk.bold.blue('🛡️ SQL INJECTION TESTING RESULTS'));
        console.log('='.repeat(70));
        
        console.log(chalk.blue(`📊 Total URLs: ${this.results.total}`));
        console.log(chalk.blue(`✅ Tested: ${this.results.tested}`));
        console.log(chalk.red(`🚨 Vulnerable: ${this.results.vulnerable}`));
        
        // Show confirmed vs potential vulnerabilities
        const confirmedCount = this.vulnerableUrls?.filter(r => 
            r.database && r.database.name && r.database.version
        ).length || 0;
        const potentialCount = this.results.vulnerable - confirmedCount;
        
        if (this.results.vulnerable > 0) {
            console.log(chalk.green(`   ✅ Confirmed (DB extracted): ${confirmedCount}`));
            console.log(chalk.yellow(`   ⚠️ Potential (partial data): ${potentialCount}`));
        }
        
        console.log(chalk.yellow(`⚠️ Errors: ${this.results.errors}`));
        console.log(chalk.green(`⏱️ Duration: ${(duration / 1000).toFixed(2)}s`));
        console.log(chalk.green(`🚀 Rate: ${rate.toFixed(1)} URLs/second`));
        
        // Display vulnerability breakdown if any found
        if (this.results.vulnerable > 0) {
            console.log(chalk.yellow(`\n🔍 Vulnerability Types Found:`));
            Object.entries(vulnerabilityStats.byType).forEach(([type, count]) => {
                console.log(chalk.cyan(`   ${type.toUpperCase()}: ${count}`));
            });
            
            console.log(chalk.yellow(`\n📋 Most Common Parameters:`));
            Object.entries(vulnerabilityStats.byParameter).slice(0, 5).forEach(([param, count]) => {
                console.log(chalk.cyan(`   ${param}: ${count} vulnerabilities`));
            });
            
            console.log(chalk.green(`\n💾 Vulnerable URLs saved to: ${this.config.outputFile}`));
        }
        
        console.log('\n' + '='.repeat(70) + '\n');
        
        this.logger?.info('SQL injection testing completed', {
            total: this.results.total,
            tested: this.results.tested,
            vulnerable: this.results.vulnerable,
            errors: this.results.errors,
            duration: duration,
            rate: rate,
            vulnerabilityStats: vulnerabilityStats
        });
    }
    
    /**
     * Calculate vulnerability statistics from stored results
     */
    calculateVulnerabilityStats() {
        const stats = { byType: {}, byParameter: {} };
        if (!this.vulnerableUrls) return stats;

        for (const result of this.vulnerableUrls) {
            if (result.vulnerabilities) {
                for (const vuln of result.vulnerabilities) {
                    stats.byType[vuln.type] = (stats.byType[vuln.type] || 0) + 1;
                    stats.byParameter[vuln.parameter] = (stats.byParameter[vuln.parameter] || 0) + 1;
                }
            }
        }
        return stats;
    }
    
    /**
     * Utility function to chunk array
     */
    chunkArray(array, chunkSize) {
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }
    
    /**
     * Cleanup resources
     */
    async cleanup() {
        try {
            // Terminate all workers
            for (const worker of this.workers) {
                await worker.terminate();
            }
            
            console.log(chalk.green('✅ Cleanup completed'));
            this.logger?.info('Standalone SQL injection tester cleanup completed');
            
        } catch (error) {
            console.error(chalk.red('❌ Cleanup error:'), error.message);
            this.logger?.error('Cleanup error', { error: error.message });
        }
    }
}

// Main execution when run as script
if (import.meta.url === `file://${process.argv[1]}`) {
    const filePath = process.argv[2];
    const concurrency = parseInt(process.argv[3]) || 10;
    
    if (!filePath) {
        console.error(chalk.red('Usage: node standaloneSQLTester.js <file_path> [concurrency]'));
        process.exit(1);
    }
    
    const tester = new StandaloneSQLTester({
        maxConcurrency: concurrency
    });
    
    (async () => {
        try {
            await tester.initialize();
            const urls = await tester.readUrlsFromFile(filePath);
            const results = await tester.testUrls(urls);
            
            console.log(chalk.cyan('\n📊 Final Results:'));
            console.log(chalk.white(`Total URLs: ${results.total}`));
            console.log(chalk.white(`Tested: ${results.tested}`));
            console.log(chalk.green(`Vulnerable: ${results.vulnerable}`));
            console.log(chalk.red(`Errors: ${results.errors}`));
            console.log(chalk.blue(`Duration: ${results.duration}ms`));
            
            await tester.cleanup();
            process.exit(0);
        } catch (error) {
            console.error(chalk.red('❌ Fatal error:'), error.message);
            await tester.cleanup();
            process.exit(1);
        }
    })();
} 