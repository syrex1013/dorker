import express from 'express';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { MultiEngineDorker } from '../dorker/MultiEngineDorker.js';
import winston from 'winston';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class Dashboard {
    constructor(config = {}, logger = null) {
        this.config = config;
        this.logger = logger;
        this.app = express();
        this.dorker = null;
        this.isSearching = false;
        this.currentSocket = null;
        this.searchTimeout = null;
        this.captchaEncounters = 0;
        this.captchaSolved = 0;
        this.serverMode = false;
        this.sessionData = {
            startTime: null,
            processed: 0,
            successful: 0,
            failed: 0,
            totalResults: 0,
            currentDork: null
        };
        
        // Set up logger transport to forward logs to WebUI if logger is provided
        if (logger) {
            this.setupLoggerTransport(logger);
        }
    }
    
    // Method to set up logger transport
    setupLoggerTransport(logger) {
        // Add a custom transport to forward logs to the WebUI
        if (logger && logger.add) {
            try {
                const self = this;
                logger.add(new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.timestamp(),
                        winston.format.json()
                    ),
                    log(info, callback) {
                        self.forwardLogToWebUI(info);
                        callback();
                    }
                }));
                
                // Send initial log to confirm transport is set up
                logger.info('Logger transport connected to WebUI');
            } catch (error) {
                console.error('Error setting up logger transport:', error);
            }
        }
    }
    
    // New method to forward logs to WebUI
    forwardLogToWebUI(logInfo) {
        if (this.currentSocket) {
            try {
                // Format the log for the WebUI
                const log = {
                    timestamp: logInfo.timestamp || new Date().toISOString(),
                    level: logInfo.level || 'info',
                    message: logInfo.message || '',
                    service: logInfo.service || 'dorker',
                    type: logInfo.level === 'error' ? 'error' : 
                          logInfo.level === 'warn' ? 'warning' : 'info'
                };
                
                // Send the log to the WebUI
                this.currentSocket.emit('newLog', log);
                
                // Also add to internal log storage for new connections
                if (!this._recentLogs) this._recentLogs = [];
                this._recentLogs.unshift(log);
                
                // Keep only the 100 most recent logs
                if (this._recentLogs.length > 100) {
                    this._recentLogs = this._recentLogs.slice(0, 100);
                }
            } catch (error) {
                console.error('Error forwarding log to WebUI:', error);
            }
        }
    }

    // Server mode setup
    setupServerMode(handlers) {
        this.serverMode = true;
        this.onStartDorking = handlers.onStartDorking;
        this.onStopDorking = handlers.onStopDorking;
    }

    // Start the server (renamed from initialize)
    async start() {
        const port = this.config.port || 3000;
        await this.initialize(port);
        
        // Log server start
        if (this.logger) {
            this.logger.info(`Dashboard running on http://localhost:${port}`);
        }
    }

    async initialize(port = 3000) {
        // Add middleware for JSON parsing
        this.app.use(express.json());
        
        // Add root redirect
        this.app.get('/', (req, res) => {
            res.redirect('/dashboard');
        });

        // Serve static files
        this.app.use(express.static(join(__dirname, 'public')));

        // Serve dashboard.html at /dashboard
        this.app.get('/dashboard', (req, res) => {
            res.sendFile(join(__dirname, 'public', 'dashboard.html'));
        });

        // API endpoints for server mode
        this.app.get('/api/server-mode', (req, res) => {
            res.json({
                enabled: this.serverMode,
                status: this.isSearching ? 'running' : 'idle',
                canStart: !this.isSearching
            });
        });

        this.app.post('/api/start-dorking', async (req, res) => {
            if (this.serverMode && this.onStartDorking) {
                const result = await this.onStartDorking(req.body);
                res.json(result);
            } else {
                res.status(400).json({ success: false, error: 'Server mode not enabled' });
            }
        });

        this.app.post('/api/stop-dorking', async (req, res) => {
            if (this.serverMode && this.onStopDorking) {
                const result = await this.onStopDorking();
                res.json(result);
            } else {
                res.status(400).json({ success: false, error: 'Server mode not enabled' });
            }
        });

        // Create HTTP server
        const server = this.app.listen(port, () => {
            if (this.logger) {
                this.logger.info(`Dashboard running on http://localhost:${port}`);
                // Send initial log to WebUI when server starts
                this.forwardLogToWebUI({
                    timestamp: new Date().toISOString(),
                    level: 'info',
                    message: `Dashboard server started on port ${port}`,
                    service: 'dorker'
                });
            }
        });

        // Initialize Socket.IO
        this.io = new Server(server);

        // Handle socket connections
        this.io.on('connection', (socket) => {
            if (this.logger) {
                this.logger.info('Client connected to dashboard');
            }
            
            this.currentSocket = socket;
            
            // Send initial status and server logs
            socket.emit('status', 'Ready');
            
            // Send server started notification
            socket.emit('notification', {
                message: '🚀 Server is ready - connect successful!',
                type: 'success'
            });
            
            // Enable start/stop button
            socket.emit('enableControls', {
                canStart: !this.isSearching,
                canStop: this.isSearching
            });
            
            // If logger exists, send a welcome log
            this.forwardLogToWebUI({
                timestamp: new Date().toISOString(),
                level: 'info',
                message: 'WebUI connected to server successfully',
                service: 'dorker'
            });
            
            // Send initial session data to initialize the UI
            this.sendInitialSessionData();

            // Handle requestLogs event - send stored logs
            socket.on('requestLogs', () => {
                try {
                    // Send stored logs to the client
                    if (this._recentLogs && this._recentLogs.length > 0) {
                        // Send logs in reverse order (oldest first) for proper display
                        const logsToSend = [...this._recentLogs].reverse();
                        socket.emit('initialLogs', logsToSend);
                        this.logger?.debug(`Sent ${logsToSend.length} stored logs to client`);
                    } else {
                        // Send empty array if no logs
                        socket.emit('initialLogs', []);
                        
                        // Also send a system startup log
                        const startupLog = {
                            timestamp: new Date().toISOString(),
                            level: 'info',
                            message: 'System started - no previous logs available',
                            service: 'dorker'
                        };
                        socket.emit('newLog', startupLog);
                    }
                } catch (error) {
                    console.error('Error sending logs to client:', error);
                    socket.emit('initialLogs', []);
                }
            });
            
            // Handle requestResults event - send stored results
            socket.on('requestResults', () => {
                try {
                    // Send stored results to the client
                    if (this._storedResults && this._storedResults.length > 0) {
                        socket.emit('initialResults', this._storedResults);
                        this.logger?.debug(`Sent ${this._storedResults.length} stored results to client`);
                    } else {
                        // Send empty array if no results
                        socket.emit('initialResults', []);
                    }
                } catch (error) {
                    console.error('Error sending results to client:', error);
                    socket.emit('initialResults', []);
                }
            });

            // Handle requestData - send current session data
            socket.on('requestData', () => {
                // Send current session data
                this.emitSessionUpdate();
                
                // Send current status
                socket.emit('status', this.isSearching ? 'searching' : 'ready');
                
                // If we have a current dork, send it
                if (this.sessionData.currentDork) {
                    this.setProcessingStatus(`Processing dork: ${this.sessionData.currentDork}`);
                }
                
                // Send stored results if they exist
                if (this._storedResults && this._storedResults.length > 0) {
                    socket.emit('initialResults', this._storedResults);
                } else {
                    // Send empty results array if none exist
                    socket.emit('initialResults', []);
                }
                
                // Send stored logs if they exist
                if (this._recentLogs && this._recentLogs.length > 0) {
                    socket.emit('initialLogs', [...this._recentLogs].reverse());
                } else {
                    // Send empty logs array if none exist
                    socket.emit('initialLogs', []);
                }
                
                // Send empty performance data
                socket.emit('performanceData', []);
                
                // Send notification that data was refreshed
                socket.emit('notification', {
                    message: 'Dashboard data refreshed',
                    type: 'info'
                });
            });

            // Handle search start
            socket.on('start_search', async (data) => {
                if (this.isSearching) {
                    socket.emit('log', {
                        type: 'error',
                        message: 'Search already in progress'
                    });
                    return;
                }

                const { dorks, engines } = data;
                if (!dorks || !Array.isArray(dorks) || dorks.length === 0) {
                    socket.emit('log', {
                        type: 'error',
                        message: 'No dorks provided'
                    });
                    return;
                }

                if (!engines || !Array.isArray(engines) || engines.length === 0) {
                    socket.emit('log', {
                        type: 'error',
                        message: 'No search engines selected'
                    });
                    return;
                }

                this.isSearching = true;
                socket.emit('status', 'Initializing...');

                try {
                    // Initialize dorker if not already initialized
                    if (!this.dorker) {
                        this.dorker = new MultiEngineDorker(this.config, this.logger, this);
                        await this.dorker.initialize();
                    }

                    // Start search process
                    this.startSearch(dorks, engines);
                } catch (error) {
                    this.logger?.error('Error initializing search:', error);
                    socket.emit('log', {
                        type: 'error',
                        message: `Error initializing search: ${error.message}`
                    });
                    this.isSearching = false;
                    socket.emit('status', 'Error');
                    socket.emit('search_complete');
                }
            });

            // Handle search stop
            socket.on('stop_search', () => {
                this.stopSearch();
            });
            
            // Handle disconnection
            socket.on('disconnect', () => {
                this.logger?.info('Client disconnected from dashboard');
                if (this.currentSocket === socket) {
                    this.currentSocket = null;
                }
            });
        });
    }

    async startSearch(dorks, engines) {
        try {
            // Reset session data
            this.sessionData = {
                startTime: new Date(),
                processed: 0,
                successful: 0,
                failed: 0,
                totalResults: 0,
                currentDork: null
            };

            // Emit session start
            if (this.currentSocket) {
                this.currentSocket.emit('sessionStart', {
                    startTime: this.sessionData.startTime,
                    totalDorks: dorks.length,
                    status: 'initializing'
                });
            }

            this.setStatus('searching');
            
            try {
                const results = await this.dorker.performBatchSearch(dorks, 30, engines);
                
                if (results && results.length > 0) {
                    this.addLog('success', `✅ Found ${results.length} total results across all dorks and engines`);
                    results.forEach(result => {
                        if (this.currentSocket) {
                            this.currentSocket.emit('newResult', result);
                        }
                    });
                } else {
                    this.addLog('warning', `⚠️ No results found for any dorks`);
                }

                // Emit successful session end
                if (this.currentSocket) {
                    this.currentSocket.emit('sessionEnd', {
                        success: true,
                        stats: this.getSessionSummary()
                    });
                }
            } catch (error) {
                this.logger?.error(`Error in search process:`, error);
                this.addLog('error', `❌ Search process error: ${error.message}`);
                
                // Emit failed session end
                if (this.currentSocket) {
                    this.currentSocket.emit('sessionEnd', {
                        success: false,
                        error: error.message
                    });
                }
            }

            this.setStatus('ready');
            this.isSearching = false;
        } catch (error) {
            this.logger?.error('Error in search process:', error);
            this.addLog('error', `❌ Search initialization error: ${error.message}`);
            
            // Emit failed session end
            if (this.currentSocket) {
                this.currentSocket.emit('sessionEnd', {
                    success: false,
                    error: error.message
                });
            }
            
            this.setStatus('error');
            this.isSearching = false;
        }
    }

    stopSearch() {
        if (this.dorker) {
            this.dorker.stop();
        }
        
        this.isSearching = false;
        this.setStatus('idle');
        
        // Emit session end with current stats
        if (this.currentSocket) {
            this.currentSocket.emit('sessionEnd', {
                success: true,
                stats: this.getSessionSummary(),
                message: 'Search stopped by user'
            });
        }
        
        this.addLog('info', '🛑 Search stopped by user');
    }

    setStatus(status) {
        if (this.currentSocket) {
            this.currentSocket.emit('status', status);
        }
    }

    addLog(type, message) {
        const log = {
            timestamp: new Date().toISOString(),
            type,
            message,
            level: type === 'error' ? 'error' : type === 'warning' ? 'warn' : 'info'
        };
        
        if (this.currentSocket) {
            this.currentSocket.emit('newLog', log);
        }
    }

    incrementCaptchaEncounters() {
        this.captchaEncounters++;
        this.addLog('info', `🚨 Total CAPTCHAs encountered: ${this.captchaEncounters}`);
    }

    incrementCaptchaSolved() {
        this.captchaSolved++;
        this.addLog('success', `✅ Total CAPTCHAs solved: ${this.captchaSolved}`);
    }

    updateProxy(proxy) {
        if (this.currentSocket) {
            this.currentSocket.emit('proxy', proxy);
        }
    }

    // Additional methods needed for server mode
    setConfiguration(config) {
        this.config = { ...this.config, ...config };
    }

    startSession(totalDorks) {
        this.sessionData = {
            startTime: Date.now(),
            processed: 0,
            successful: 0,
            failed: 0,
            totalResults: 0,
            currentDork: null,
            totalDorks
        };

        // Emit session start event with complete data
        if (this.currentSocket) {
            this.currentSocket.emit('sessionStart', {
                startTime: this.sessionData.startTime,
                totalDorks: totalDorks,
                status: 'initializing'
            });
        }
        
        // Immediately emit session update to initialize UI
        this.emitSessionUpdate();

        // Start periodic runtime updates every second
        if (this.runtimeTimer) clearInterval(this.runtimeTimer);
        this.runtimeTimer = setInterval(() => {
            this.emitSessionUpdate();
        }, 1000);
    }

    setCurrentDork(dork) {
        this.sessionData.currentDork = dork;
        this.emitSessionUpdate();
        this.setProcessingStatus(`Processing dork: ${dork}`);
    }

    incrementProcessed() {
        this.sessionData.processed++;
        this.emitSessionUpdate();
    }

    incrementSuccessful() {
        this.sessionData.successful++;
        this.emitSessionUpdate();
    }

    incrementFailed() {
        this.sessionData.failed++;
        this.emitSessionUpdate();
    }

    addToTotalResults(count) {
        this.sessionData.totalResults += count;
        this.emitSessionUpdate();
    }

    addResult(dork, results, engine = 'unknown') {
        if (!results || !Array.isArray(results)) {
            this.logger?.warn('Invalid results passed to addResult', { dork });
            return;
        }
        
        // Store results for new connections
        if (!this._storedResults) this._storedResults = [];
        
        // Add new result to stored results
        this._storedResults.unshift({
            dork,
            count: results.length,
            results,
            timestamp: Date.now(),
            engine // Store the search engine that provided these results
        });
        
        // Keep only the 50 most recent result sets
        if (this._storedResults.length > 50) {
            this._storedResults = this._storedResults.slice(0, 50);
        }
        
        // Send to current client
        if (this.currentSocket) {
            this.currentSocket.emit('newResult', { 
                dork, 
                count: results.length, 
                results,
                timestamp: Date.now(),
                engine
            });
            
            // Also update session stats
            this.emitSessionUpdate();
            
            // Log the new results
            this.addLog('info', `📊 Found ${results.length} results for: ${dork.substring(0, 30)}${dork.length > 30 ? '...' : ''} with ${engine}`);
        }
    }

    endSession() {
        const runtime = Date.now() - this.sessionData.startTime;
        this.sessionData.runtime = runtime;

        if (this.runtimeTimer) {
            clearInterval(this.runtimeTimer);
            this.runtimeTimer = null;
        }

        // Send final session data
        if (this.currentSocket) {
            // Get complete session summary
            const summary = this.getSessionSummary();
            
            // Emit session end event
            this.currentSocket.emit('sessionEnd', {
                success: true,
                stats: summary,
                message: 'Session completed'
            });
            
            // Also emit final stats update
            this.emitSessionUpdate();
            
            // Send notification
            this.sendNotification('Session completed', 'success');
        }
    }

    getSessionSummary() {
        const runtime = this.sessionData.runtime || (Date.now() - this.sessionData.startTime);
        const minutes = Math.floor(runtime / 60000);
        const seconds = Math.floor((runtime % 60000) / 1000);
        
        return {
            processedDorks: this.sessionData.processed,
            successRate: this.sessionData.processed > 0 
                ? Math.round((this.sessionData.successful / this.sessionData.processed) * 100)
                : 0,
            totalResults: this.sessionData.totalResults,
            runtimeFormatted: `${minutes}m ${seconds}s`
        };
    }

    sendNotification(message, type = 'info', persistent = false) {
        if (this.currentSocket) {
            this.currentSocket.emit('notification', { message, type, persistent });
        }
    }

    setProcessingStatus(status) {
        if (this.currentSocket) {
            this.currentSocket.emit('processing_status', status);
        }
    }

    // Emit current sessionData summary to client
    emitSessionUpdate() {
        if (this.currentSocket) {
            const stats = {
                startTime: this.sessionData.startTime,
                processedDorks: this.sessionData.processed,
                successfulDorks: this.sessionData.successful,
                failedDorks: this.sessionData.failed,
                totalResults: this.sessionData.totalResults,
                currentDork: this.sessionData.currentDork,
                totalDorks: this.sessionData.totalDorks || 0,
                status: this.isSearching ? 'searching' : 'idle',
                captchaEncounters: this.captchaEncounters,
                captchaSolved: this.captchaSolved,
                proxy: this.config.proxy || null,
                runtime: Date.now() - (this.sessionData.startTime || Date.now())
            };
            
            this.currentSocket.emit('stats', stats);
            
            // Also emit processing status
            if (this.sessionData.currentDork) {
                this.setProcessingStatus(`Processing dork: ${this.sessionData.currentDork}`);
            }
        }
    }
    
    // Send initial session data to client
    sendInitialSessionData() {
        if (this.currentSocket) {
            // Send default stats to initialize UI
            const defaultStats = {
                startTime: null,
                processedDorks: 0,
                successfulDorks: 0,
                failedDorks: 0,
                totalResults: 0,
                currentDork: null,
                totalDorks: 0,
                status: 'idle',
                captchaEncounters: this.captchaEncounters,
                captchaSolved: this.captchaSolved,
                proxy: this.config.proxy || null
            };
            
            this.currentSocket.emit('stats', defaultStats);
            this.currentSocket.emit('status', 'ready');
        }
    }
}
