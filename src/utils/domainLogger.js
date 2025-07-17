import winston from 'winston';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Map to store domain-specific loggers
const domainLoggers = new Map();

// Store the current log level (default to debug)
let currentLogLevel = 'debug';

/**
 * Extract relevant error information from HTML responses
 */
function extractRelevantErrorInfo(htmlContent) {
    // Extract only SQL-related error messages
    const errorPatterns = [
        /(sql syntax[^<]*)/i,
        /(mysql[^<]*error[^<]*)/i,
        /(ORA-\d+[^<]*)/i,
        /(SQLiteException[^<]*)/i,
        /(MariaDB[^<]*error[^<]*)/i,
        /(SQLSTATE[^<]*)/i,
        /(syntax error[^<]*)/i,
        /(Warning.*mysql[^<]*)/i,
        /(Unclosed quotation mark[^<]*)/i,
        /(PostgreSQL[^<]*error[^<]*)/i,
        /(Fatal error[^<]*)/i,
        /(Access Database[^<]*)/i,
        /(JET Database[^<]*)/i,
        /(ODBC[^<]*error[^<]*)/i,
        /(ADO[^<]*error[^<]*)/i
    ];
    
    for (const pattern of errorPatterns) {
        const match = htmlContent.match(pattern);
        if (match) {
            // Extract up to 200 characters around the error
            const errorIndex = htmlContent.indexOf(match[0]);
            const start = Math.max(0, errorIndex - 50);
            const end = Math.min(htmlContent.length, errorIndex + match[0].length + 150);
            return htmlContent.substring(start, end).replace(/\s+/g, ' ').trim();
        }
    }
    
    // If no specific error found, return first 200 chars
    return htmlContent.substring(0, 200).replace(/\s+/g, ' ').trim() + '...';
}

/**
 * Extract database information from responses
 */
function extractDatabaseInfo(content) {
    const dbPatterns = {
        version: [
            /(\d+\.\d+\.\d+(?:-\d+)?)/,  // MySQL/MariaDB version format
            /PostgreSQL (\d+\.\d+)/i,
            /Oracle.*?(\d+[cg]?)/i,
            /SQL Server.*?(\d{4})/i,
            /SQLite (\d+\.\d+\.\d+)/i
        ],
        name: [
            /database[:\s]+['"]?([a-zA-Z0-9_]+)['"]?/i,
            /schema[:\s]+['"]?([a-zA-Z0-9_]+)['"]?/i,
            /catalog[:\s]+['"]?([a-zA-Z0-9_]+)['"]?/i
        ]
    };
    
    const info = {};
    
    // Extract version
    for (const pattern of dbPatterns.version) {
        const match = content.match(pattern);
        if (match) {
            info.version = match[1];
            break;
        }
    }
    
    // Extract database name
    for (const pattern of dbPatterns.name) {
        const match = content.match(pattern);
        if (match) {
            info.name = match[1];
            break;
        }
    }
    
    return info;
}

/**
 * Get or create a logger for a specific domain
 */
export async function getDomainLogger(url) {
    let domain;
    try {
        const urlObj = new URL(url);
        domain = urlObj.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    } catch {
        domain = 'invalid_url';
    }
    
    // Check if logger already exists
    if (domainLoggers.has(domain)) {
        return domainLoggers.get(domain);
    }
    
    // Create logs directory structure
    const logsDir = path.resolve(__dirname, '../../logs/sql');
    const domainLogsDir = path.join(logsDir, domain);
    
    try {
        await fs.mkdir(domainLogsDir, { recursive: true });
    } catch (error) {
        console.error(`Failed to create logs directory for ${domain}:`, error);
    }
    
    // Create domain-specific logger
    const logger = winston.createLogger({
        level: currentLogLevel,
        format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.errors({ stack: true }),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
                let logMessage = `${timestamp} [${level.toUpperCase()}] ${message}`;
                
                // Handle SQL injection specific data
                if (meta.sqlInjection) {
                    const sqlData = meta.sqlInjection;
                    logMessage += '\n[SQL INJECTION DETAILS]';
                    logMessage += `\n  URL: ${sqlData.url}`;
                    logMessage += `\n  Parameter: ${sqlData.parameter}`;
                    logMessage += `\n  Payload: ${sqlData.payload}`;
                    logMessage += `\n  Type: ${sqlData.type}`;
                    
                    if (sqlData.evidence) {
                        logMessage += `\n  Evidence: ${sqlData.evidence}`;
                    }
                    
                    if (sqlData.dbHint) {
                        logMessage += `\n  DB Hint: ${JSON.stringify(sqlData.dbHint)}`;
                    }
                    
                    if (sqlData.extractedData) {
                        logMessage += `\n  Extracted Data: ${JSON.stringify(sqlData.extractedData)}`;
                    }
                    
                    if (sqlData.responseTime) {
                        logMessage += `\n  Response Time: ${sqlData.responseTime}ms`;
                    }
                }
                
                // Handle HTML responses - extract only relevant parts
                if (meta.htmlResponse) {
                    logMessage += `\n  Error Evidence: ${extractRelevantErrorInfo(meta.htmlResponse)}`;
                }
                
                // Handle database extraction responses
                if (meta.dbExtraction) {
                    const dbData = meta.dbExtraction;
                    logMessage += '\n[DB EXTRACTION]';
                    logMessage += `\n  Method: ${dbData.method}`;
                    logMessage += `\n  Query: ${dbData.query}`;
                    
                    if (dbData.response) {
                        const dbInfo = extractDatabaseInfo(dbData.response);
                        if (Object.keys(dbInfo).length > 0) {
                            logMessage += `\n  Extracted Info: ${JSON.stringify(dbInfo)}`;
                        }
                        logMessage += `\n  Raw Response: ${dbData.response.substring(0, 200)}...`;
                    }
                    
                    if (dbData.success !== undefined) {
                        logMessage += `\n  Success: ${dbData.success}`;
                    }
                }
                
                // Add any remaining metadata
                const remainingMeta = { ...meta };
                delete remainingMeta.sqlInjection;
                delete remainingMeta.htmlResponse;
                delete remainingMeta.dbExtraction;
                
                if (Object.keys(remainingMeta).length > 0) {
                    logMessage += ` | ${JSON.stringify(remainingMeta)}`;
                }
                
                return logMessage;
            })
        ),
        transports: [
            new winston.transports.File({
                filename: path.join(domainLogsDir, 'sql-injection.log'),
                maxsize: 10 * 1024 * 1024, // 10MB
                maxFiles: 5
            }),
            new winston.transports.File({
                filename: path.join(domainLogsDir, 'vulnerabilities.log'),
                level: 'error',
                maxsize: 5 * 1024 * 1024, // 5MB
                maxFiles: 3
            })
        ]
    });
    
    // Store logger for reuse
    domainLoggers.set(domain, logger);
    
    // Add helper methods
    logger.logSqlInjection = (message, data) => {
        logger.info(message, { sqlInjection: data });
    };
    
    logger.logDbExtraction = (message, data) => {
        logger.info(message, { dbExtraction: data });
    };
    
    logger.logHtmlResponse = (message, html) => {
        logger.debug(message, { htmlResponse: html });
    };
    
    return logger;
}

/**
 * Set the log level for all domain loggers
 */
export function setDomainLogLevel(level) {
    currentLogLevel = level;
    // Update existing loggers
    for (const logger of domainLoggers.values()) {
        logger.level = level;
    }
}

/**
 * Clear all domain loggers (useful for cleanup)
 */
export function clearDomainLoggers() {
    domainLoggers.clear();
} 