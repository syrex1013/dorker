import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DashboardServer {
  constructor(port = 3000) {
    this.port = port;
    this.app = express();
    this.server = createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    this.stats = {
      startTime: null,
      totalDorks: 0,
      processedDorks: 0,
      successfulDorks: 0,
      failedDorks: 0,
      totalResults: 0,
      currentDork: "",
      status: "idle",
      proxy: null,
      captchaEncounters: 0,
      captchaSolved: 0,
    };

    // Store current configuration
    this.currentConfig = null;

    this.results = [];
    this.logs = [];
    this.performanceData = [];
    this.connectedClients = 0;
    this.notifications = [];

    // Server mode handlers
    this.serverModeHandlers = {
      onStartDorking: null,
      onStopDorking: null,
    };
    this.isServerMode = false;

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketIO();

    // Enhanced heartbeat for live updates
    this.heartbeatInterval = setInterval(() => {
      this.broadcastStats();
      this.cleanupOldData();
    }, 2000); // More frequent updates for better responsiveness

    // Performance tracking
    this.performanceInterval = setInterval(() => {
      this.trackPerformance();
    }, 5000);
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, "public")));
  }

  setupRoutes() {
    // Serve the dashboard HTML
    this.app.get("/", (req, res) => {
      res.sendFile(path.join(__dirname, "public", "dashboard.html"));
    });

    // Enhanced API endpoints
    this.app.get("/api/stats", (req, res) => {
      res.json({
        ...this.stats,
        config: this.currentConfig,
      });
    });

    this.app.get("/api/results", (req, res) => {
      res.json(this.results);
    });

    this.app.get("/api/logs", (req, res) => {
      res.json(this.logs.slice(-100));
    });

    this.app.get("/api/performance", (req, res) => {
      res.json(this.performanceData.slice(-50)); // Last 50 data points
    });

    this.app.get("/api/export", (req, res) => {
      const exportData = {
        stats: this.stats,
        results: this.results,
        logs: this.logs,
        performance: this.performanceData,
        exportTime: new Date().toISOString(),
        sessionSummary: this.getSessionSummary(),
      };
      res.json(exportData);
    });

    // Health check endpoint
    this.app.get("/api/health", (req, res) => {
      res.json({
        status: "healthy",
        uptime: process.uptime(),
        connectedClients: this.connectedClients,
        memoryUsage: process.memoryUsage(),
        lastUpdate: new Date().toISOString(),
        serverMode: this.isServerMode,
      });
    });

    // Server mode endpoints
    this.app.get("/api/server-mode", (req, res) => {
      res.json({
        enabled: this.isServerMode,
        status: this.stats.status,
        canStart:
          this.stats.status === "idle" ||
          this.stats.status === "completed" ||
          this.stats.status === "error",
      });
    });

    this.app.post("/api/start-dorking", async (req, res) => {
      if (!this.isServerMode) {
        return res.status(400).json({ error: "Server mode not enabled" });
      }

      if (!this.serverModeHandlers.onStartDorking) {
        return res.status(500).json({ error: "Start handler not configured" });
      }

      if (this.stats.status === "running") {
        return res
          .status(400)
          .json({ error: "Dorking session already running" });
      }

      try {
        const config = req.body;
        const result = await this.serverModeHandlers.onStartDorking(config);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post("/api/stop-dorking", async (req, res) => {
      if (!this.isServerMode) {
        return res.status(400).json({ error: "Server mode not enabled" });
      }

      if (!this.serverModeHandlers.onStopDorking) {
        return res.status(500).json({ error: "Stop handler not configured" });
      }

      try {
        const result = await this.serverModeHandlers.onStopDorking();
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  setupSocketIO() {
    this.io.on("connection", (socket) => {
      this.connectedClients++;
      console.log(
        `👥 Dashboard client connected (${this.connectedClients} total)`
      );

      // Send comprehensive initial data
      socket.emit("stats", this.stats);
      socket.emit("initialResults", this.results.slice(-20));
      socket.emit("initialLogs", this.logs.slice(-50));
      socket.emit("performanceData", this.performanceData.slice(-20));

      // Handle enhanced client requests
      socket.on("requestData", () => {
        socket.emit("stats", this.stats);
        socket.emit("initialResults", this.results.slice(-20));
        socket.emit("initialLogs", this.logs.slice(-50));
        socket.emit("performanceData", this.performanceData.slice(-20));
      });

      socket.on("requestExport", () => {
        socket.emit("exportData", this.getExportData());
      });

      socket.on("clearResults", () => {
        this.results = [];
        this.io.emit("resultsCleared");
        this.addLog("info", "Results cleared by user");
      });

      socket.on("clearLogs", () => {
        this.logs = [];
        this.io.emit("logsCleared");
        this.addLog("info", "Logs cleared by user");
      });

      // Enhanced ping/pong with latency tracking
      socket.on("ping", (timestamp) => {
        const latency = Date.now() - (timestamp || Date.now());
        socket.emit("pong", { latency, serverTime: Date.now() });
      });

      socket.on("disconnect", () => {
        this.connectedClients--;
        console.log(
          `👤 Dashboard client disconnected (${this.connectedClients} total)`
        );
      });
    });
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(
            `🌐 Enhanced Dashboard server running at http://localhost:${this.port}`
          );
          this.addLog("info", `Dashboard server started on port ${this.port}`);
          resolve();
        }
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }

      if (this.performanceInterval) {
        clearInterval(this.performanceInterval);
      }

      this.server.close(() => {
        console.log("🛑 Enhanced Dashboard server stopped");
        resolve();
      });
    });
  }

  // Enhanced statistics management
  updateStats(newStats) {
    const previousStats = { ...this.stats };
    this.stats = { ...this.stats, ...newStats };

    // Track significant changes for notifications
    this.checkForNotificationTriggers(previousStats, this.stats);

    this.broadcastStats();
  }

  checkForNotificationTriggers(prev, current) {
    // CAPTCHA encountered
    if (current.captchaEncounters > prev.captchaEncounters) {
      this.sendNotification(
        "CAPTCHA detected - attempting to solve",
        "warning"
      );
    }

    // CAPTCHA solved
    if (current.captchaSolved > prev.captchaSolved) {
      this.sendNotification("CAPTCHA solved successfully", "success");
    }

    // Major milestone reached
    if (
      current.processedDorks > 0 &&
      current.processedDorks % 10 === 0 &&
      current.processedDorks !== prev.processedDorks
    ) {
      this.sendNotification(
        `Processed ${current.processedDorks} dorks`,
        "info"
      );
    }

    // High success rate achievement
    const successRate =
      current.processedDorks > 0
        ? (current.successfulDorks / current.processedDorks) * 100
        : 0;
    if (successRate >= 80 && current.processedDorks >= 5) {
      this.sendNotification(
        `High success rate: ${Math.round(successRate)}%`,
        "success"
      );
    }
  }

  sendNotification(message, type = "info", persistent = false) {
    const notification = {
      id: Date.now(),
      message,
      type,
      timestamp: new Date().toISOString(),
      persistent,
    };

    this.notifications.unshift(notification);

    // Keep only last 50 notifications
    if (this.notifications.length > 50) {
      this.notifications = this.notifications.slice(0, 50);
    }

    this.io.emit("notification", notification);
  }

  addResult(dork, results) {
    // Enhanced result handling
    let resultEntry;

    if (typeof dork === "object" && dork.dork) {
      resultEntry = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        dork: dork.dork,
        results: dork.results || [],
        count: dork.results ? dork.results.length : dork.count || 0,
        searchTime: dork.searchTime || null,
        engine: dork.engine || "unknown",
      };
    } else {
      resultEntry = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        dork: dork,
        results: results || [],
        count: results ? results.length : 0,
        searchTime: null,
        engine: "unknown",
      };
    }

    this.results.unshift(resultEntry);
    // totalResults is already incremented via addToTotalResults method called from main.js

    // Keep only last 100 result sets for memory management
    if (this.results.length > 100) {
      this.results = this.results.slice(0, 100);
    }

    // Enhanced broadcasting
    this.io.emit("newResult", resultEntry);
    this.broadcastStats();

    // Add performance-aware logging
    const searchTimeText = resultEntry.searchTime
      ? ` (${resultEntry.searchTime}ms)`
      : "";
    this.addLog(
      "success",
      `Found ${resultEntry.count} results for dork${searchTimeText}`,
      {
        dork: resultEntry.dork,
        count: resultEntry.count,
        searchTime: resultEntry.searchTime,
      }
    );
  }

  addLog(level, message, data = null) {
    const logEntry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      level: level.toLowerCase(),
      message: message,
      data: data,
      source: "dorker",
    };

    this.logs.unshift(logEntry);

    // Keep only last 1000 logs for better history
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(0, 1000);
    }

    this.io.emit("newLog", logEntry);
  }

  // Performance tracking
  trackPerformance() {
    if (this.stats.status === "running") {
      const performancePoint = {
        timestamp: new Date().toISOString(),
        processed: this.stats.processedDorks,
        successful: this.stats.successfulDorks,
        failed: this.stats.failedDorks,
        totalResults: this.stats.totalResults,
        captchaEncounters: this.stats.captchaEncounters,
        captchaSolved: this.stats.captchaSolved,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
      };

      this.performanceData.push(performancePoint);

      // Keep only last 200 performance points
      if (this.performanceData.length > 200) {
        this.performanceData = this.performanceData.slice(-200);
      }

      this.io.emit("performanceUpdate", performancePoint);
    }
  }

  // Data cleanup
  cleanupOldData() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Clean old notifications
    this.notifications = this.notifications.filter(
      (n) => new Date(n.timestamp) > oneDayAgo || n.persistent
    );

    // Clean old performance data
    this.performanceData = this.performanceData.filter(
      (p) => new Date(p.timestamp) > oneDayAgo
    );
  }

  // Session management with enhanced features
  startSession(totalDorks) {
    this.stats = {
      startTime: new Date().toISOString(),
      totalDorks: totalDorks,
      processedDorks: 0,
      successfulDorks: 0,
      failedDorks: 0,
      totalResults: 0,
      currentDork: "",
      status: "running",
      proxy: null,
      captchaEncounters: 0,
      captchaSolved: 0,
    };

    // Reset session data
    this.results = [];
    this.logs = [];
    this.performanceData = [];
    this.notifications = [];

    this.io.emit("sessionStart", this.stats);
    this.broadcastStats();

    this.addLog(
      "info",
      `🚀 New dorking session started with ${totalDorks} dorks`
    );
    this.sendNotification(
      `Started new session with ${totalDorks} dorks`,
      "info"
    );
  }

  endSession() {
    this.updateStats({ status: "completed", currentDork: null });

    const summary = this.getSessionSummary();
    this.addLog("success", "✅ Dorking session completed", summary);
    this.sendNotification(
      `Session completed: ${summary.successRate}% success rate`,
      "success",
      true
    );
  }

  getSessionSummary() {
    const runtime = this.stats.startTime
      ? Date.now() - new Date(this.stats.startTime).getTime()
      : 0;

    return {
      totalDorks: this.stats.totalDorks,
      processedDorks: this.stats.processedDorks,
      successfulDorks: this.stats.successfulDorks,
      failedDorks: this.stats.failedDorks,
      totalResults: this.stats.totalResults,
      captchaEncounters: this.stats.captchaEncounters,
      captchaSolved: this.stats.captchaSolved,
      successRate:
        this.stats.processedDorks > 0
          ? Math.round(
              (this.stats.successfulDorks / this.stats.processedDorks) * 100
            )
          : 0,
      averageResultsPerDork:
        this.stats.successfulDorks > 0
          ? Math.round(this.stats.totalResults / this.stats.successfulDorks)
          : 0,
      runtime: runtime,
      runtimeFormatted: this.formatDuration(runtime),
    };
  }

  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    return `${hours.toString().padStart(2, "0")}:${(minutes % 60)
      .toString()
      .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  }

  getExportData() {
    return {
      metadata: {
        exportTime: new Date().toISOString(),
        version: "2.0",
        sessionSummary: this.getSessionSummary(),
      },
      stats: this.stats,
      results: this.results,
      logs: this.logs,
      performance: this.performanceData,
      notifications: this.notifications,
    };
  }

  // Enhanced utility methods
  setCurrentDork(dork) {
    this.updateStats({ currentDork: dork });
  }

  incrementProcessed() {
    this.updateStats({ processedDorks: this.stats.processedDorks + 1 });
  }

  incrementSuccessful() {
    this.updateStats({ successfulDorks: this.stats.successfulDorks + 1 });
  }

  incrementFailed() {
    this.updateStats({ failedDorks: this.stats.failedDorks + 1 });
  }

  incrementCaptchaEncounters() {
    this.updateStats({ captchaEncounters: this.stats.captchaEncounters + 1 });
  }

  incrementCaptchaSolved() {
    this.updateStats({ captchaSolved: this.stats.captchaSolved + 1 });
  }

  setProxy(proxyInfo) {
    this.updateStats({ proxy: proxyInfo });

    if (proxyInfo) {
      this.addLog(
        "info",
        `Switched to proxy: ${proxyInfo.host}:${proxyInfo.port}`,
        proxyInfo
      );
      this.sendNotification(
        `Proxy switched: ${proxyInfo.host}:${proxyInfo.port}`,
        "info"
      );
    } else {
      this.addLog("info", "No proxy configured");
    }
  }

  // Compatibility methods for main.js
  setStatus(status) {
    this.updateStats({ status });
  }

  setProcessingStatus(processingStatus) {
    // Send real-time processing status to connected clients
    this.io.emit("processingStatus", { 
      status: processingStatus,
      timestamp: new Date().toISOString()
    });
    
    if (processingStatus) {
      this.addLog("info", processingStatus);
    }
  }

  addToTotalResults(count) {
    this.updateStats({ totalResults: this.stats.totalResults + count });
  }

  // Broadcast with enhanced features
  broadcastStats() {
    this.io.emit("stats", this.stats);
  }

  // Health monitoring
  getStatus() {
    return {
      isRunning: this.server.listening,
      connectedClients: this.connectedClients,
      stats: this.stats,
      resultsCount: this.results.length,
      logsCount: this.logs.length,
      performanceDataPoints: this.performanceData.length,
      notifications: this.notifications.length,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      lastUpdate: new Date().toISOString(),
    };
  }

  // Enhanced logging methods
  logInfo(message, data = null) {
    this.addLog("info", message, data);
  }

  logSuccess(message, data = null) {
    this.addLog("success", message, data);
  }

  logWarning(message, data = null) {
    this.addLog("warning", message, data);
  }

  logError(message, data = null) {
    this.addLog("error", message, data);
  }

  // CAPTCHA specific logging with notifications
  logCaptchaEncounter(engine, method = "detected") {
    this.incrementCaptchaEncounters();
    this.logWarning(`CAPTCHA ${method} on ${engine}`, { engine, method });
    this.sendNotification(`CAPTCHA detected on ${engine}`, "warning");
  }

  logCaptchaSolved(engine, method = "manual") {
    this.incrementCaptchaSolved();
    this.logSuccess(`CAPTCHA solved on ${engine} using ${method}`, {
      engine,
      method,
    });
    this.sendNotification(`CAPTCHA solved on ${engine}`, "success");
  }

  logCaptchaFailed(engine, reason = "unknown") {
    this.logError(`CAPTCHA solve failed on ${engine}: ${reason}`, {
      engine,
      reason,
    });
    this.sendNotification(`CAPTCHA failed on ${engine}: ${reason}`, "error");
  }

  // Proxy management with enhanced logging
  updateProxy(proxy) {
    this.setProxy(proxy);
  }

  // Configuration management
  setConfiguration(config) {
    this.currentConfig = {
      ...config,
      // Sanitize sensitive data
      proxyConfig: config.proxyConfig
        ? {
            host: config.proxyConfig.host,
            port: config.proxyConfig.port,
            type: config.proxyConfig.type,
            // Don't expose credentials
          }
        : null,
    };
    this.addLog(
      "info",
      `Configuration updated: ${Object.keys(config).length} settings loaded`
    );
  }

  getConfiguration() {
    return this.currentConfig;
  }

  // Server mode methods
  setupServerMode(handlers) {
    this.isServerMode = true;
    this.serverModeHandlers = {
      onStartDorking: handlers.onStartDorking || null,
      onStopDorking: handlers.onStopDorking || null,
    };
    this.addLog("info", "Server mode enabled - ready for web configuration");
  }
}

export default DashboardServer;
