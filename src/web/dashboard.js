import express from 'express';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { MultiEngineDorker } from '../dorker/MultiEngineDorker.js';

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
            this.logger?.info(`Dashboard running on http://localhost:${port}`);
        });

        // Initialize Socket.IO
        this.io = new Server(server);

        // Handle socket connections
        this.io.on('connection', (socket) => {
            this.logger?.info('Client connected to dashboard');
            this.currentSocket = socket;

            // Send initial status
            socket.emit('status', 'Ready');

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
            this.setStatus('searching');
            
            for (const dork of dorks) {
                if (!this.isSearching) break;

                this.addLog('info', `🔍 Searching for: ${dork}`);
                
                try {
                    const results = await this.dorker.performSearch(dork, 30, engines);
                    
                    if (results && results.length > 0) {
                        this.addLog('success', `✅ Found ${results.length} results for: ${dork}`);
                        results.forEach(result => {
                            if (this.currentSocket) {
                                this.currentSocket.emit('result', result);
                            }
                        });
                    } else {
                        this.addLog('warning', `⚠️ No results found for: ${dork}`);
                    }
                } catch (error) {
                    this.logger?.error(`Error searching dork: ${dork}`, error);
                    this.addLog('error', `❌ Error searching: ${dork} - ${error.message}`);
                }

                // Add delay between dorks
                if (this.isSearching && dorks.indexOf(dork) < dorks.length - 1) {
                    await new Promise(resolve => {
                        this.searchTimeout = setTimeout(resolve, 5000);
                    });
                }
            }

            this.setStatus('ready');
            this.isSearching = false;
            
            if (this.currentSocket) {
                this.currentSocket.emit('search_complete');
            }
        } catch (error) {
            this.logger?.error('Error in search process:', error);
            this.addLog('error', `❌ Search process error: ${error.message}`);
            this.setStatus('error');
            this.isSearching = false;
            
            if (this.currentSocket) {
                this.currentSocket.emit('search_complete');
            }
        }
    }

    stopSearch() {
        this.isSearching = false;
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = null;
        }
        this.setStatus('ready');
        this.addLog('info', '⏹️ Search stopped by user');
        
        if (this.currentSocket) {
            this.currentSocket.emit('search_complete');
        }
    }

    setStatus(status) {
        if (this.currentSocket) {
            this.currentSocket.emit('status', status);
        }
    }

    addLog(type, message) {
        if (this.currentSocket) {
            this.currentSocket.emit('log', { type, message });
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
    }

    setCurrentDork(dork) {
        this.sessionData.currentDork = dork;
    }

    incrementProcessed() {
        this.sessionData.processed++;
    }

    incrementSuccessful() {
        this.sessionData.successful++;
    }

    incrementFailed() {
        this.sessionData.failed++;
    }

    addToTotalResults(count) {
        this.sessionData.totalResults += count;
    }

    addResult(dork, results) {
        // Store results if needed
        this.addLog('info', `Added ${results.length} results for dork`);
    }

    endSession() {
        const runtime = Date.now() - this.sessionData.startTime;
        this.sessionData.runtime = runtime;
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
}
