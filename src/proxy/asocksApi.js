import axios from "axios";
import chalk from "chalk";
import { ASOCKS_CONFIG } from "../config/index.js";
import { logWithDedup } from "../utils/logger.js";

// Global API test cache to prevent duplicate testing
let ASOCKS_API_TESTED = false;
let ASOCKS_API_WORKS = false;

/**
 * Test ASOCKS API connectivity
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<boolean>} API test result
 */
async function testAsocksAPI(logger = null) {
  // Use global cache to prevent duplicate testing
  if (ASOCKS_API_TESTED) {
    if (ASOCKS_API_WORKS) {
      logWithDedup(
        "info",
        "✅ ASOCKS API already verified (cached)",
        chalk.green,
        logger
      );
    } else {
      logWithDedup(
        "error",
        "❌ ASOCKS API previously failed (cached)",
        chalk.red,
        logger
      );
    }
    return ASOCKS_API_WORKS;
  }

  if (!ASOCKS_CONFIG.apiKey) {
    logWithDedup("error", "❌ No ASOCKS API key configured", chalk.red, logger);
    logWithDedup(
      "info",
      "   Please set ASOCKS_API_KEY in your environment variables",
      chalk.yellow,
      logger
    );
    ASOCKS_API_TESTED = true;
    ASOCKS_API_WORKS = false;
    return false;
  }

  try {
    logWithDedup(
      "info",
      "🔍 Testing ASOCKS API connection...",
      chalk.blue,
      logger
    );
    logWithDedup(
      "info",
      `   API Key: ${ASOCKS_CONFIG.apiKey.substring(0, 8)}...`,
      chalk.gray,
      logger
    );

    // Test API connectivity using plan info endpoint
    const response = await axios.get(
      `https://api.asocks.com/v2/plan/info?apiKey=${ASOCKS_CONFIG.apiKey}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 10000,
      }
    );

    if (response.data && response.data.success === true) {
      logWithDedup(
        "success",
        "✅ ASOCKS API connection successful",
        chalk.green,
        logger
      );
      if (response.data.message?.tariffName) {
        logWithDedup(
          "info",
          `   Plan: ${response.data.message.tariffName}`,
          chalk.gray,
          logger
        );
      }
      if (response.data.message?.expiredDate) {
        logWithDedup(
          "info",
          `   Valid until: ${response.data.message.expiredDate}`,
          chalk.gray,
          logger
        );
      }
      ASOCKS_API_TESTED = true;
      ASOCKS_API_WORKS = true;
      return true;
    } else {
      logWithDedup(
        "error",
        "❌ ASOCKS API returned unsuccessful response",
        chalk.red,
        logger
      );
      logWithDedup(
        "debug",
        `   Response: ${JSON.stringify(response.data, null, 2)}`,
        chalk.gray,
        logger
      );
      ASOCKS_API_TESTED = true;
      ASOCKS_API_WORKS = false;
      return false;
    }
  } catch (error) {
    logWithDedup("error", "❌ ASOCKS API connection failed", chalk.red, logger);
    logWithDedup("debug", `   Error: ${error.message}`, chalk.gray, logger);
    if (error.response?.data) {
      logWithDedup(
        "debug",
        `   Response: ${JSON.stringify(error.response.data, null, 2)}`,
        chalk.gray,
        logger
      );
    }
    ASOCKS_API_TESTED = true;
    ASOCKS_API_WORKS = false;
    return false;
  }
}

/**
 * Generate a new proxy through ASOCKS API
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<Object|null>} Proxy configuration or null if failed
 */
async function generateProxy(logger = null) {
  // Check if we have a real proxy service configured
  if (!ASOCKS_CONFIG.apiKey) {
    logger?.debug("No proxy service configured - proxy generation disabled");
    logWithDedup(
      "warning",
      "⚠️ Proxy service not configured - skipping proxy switch",
      chalk.yellow,
      logger
    );
    return null;
  }

  // Use cached API test result
  if (!ASOCKS_API_WORKS && ASOCKS_API_TESTED) {
    logger?.debug("ASOCKS API previously failed, skipping proxy generation");
    return null;
  }

  try {
    logger?.debug("Attempting to generate proxy via ASOCKS API");
    logWithDedup(
      "info",
      "🌐 Generating new proxy via ASOCKS API...",
      chalk.blue,
      logger
    );

    // ASOCKS API create-port endpoint
    const response = await axios.post(
      `https://api.asocks.com/v2/proxy/create-port?apiKey=${ASOCKS_CONFIG.apiKey}`,
      {
        country_code: "US",
        state: "New York",
        city: "New York",
        asn: 11,
        type_id: 1, // 1 = residential, 2 = datacenter
        proxy_type_id: 2, // 1 = HTTP, 2 = SOCKS5
        name: null,
        server_port_type_id: 1,
        count: 1,
        ttl: 1, // Time to live in days
        traffic_limit: 10, // GB limit
      },
      {
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 15000, // 15 second timeout for proxy creation
      }
    );

    // Log the full response for debugging
    logger?.info("ASOCKS API Response", {
      status: response.status,
      data: response.data,
    });

    if (
      response.data &&
      response.data.success === true &&
      response.data.data &&
      response.data.data.length > 0
    ) {
      const proxyData = response.data.data[0]; // Get first proxy from the array

      logger?.info("Successfully generated proxy via ASOCKS API", {
        server: proxyData.server,
        port: proxyData.port,
        id: proxyData.id,
        login: proxyData.login,
      });

      return {
        id: proxyData.id,
        host: proxyData.server,
        port: proxyData.port,
        username: proxyData.login,
        password: proxyData.password,
        type: "SOCKS5", // ASOCKS uses proxy_type_id: 2 for SOCKS5
      };
    } else {
      // Log the response for debugging if it doesn't match expected format
      logWithDedup("debug", "📋 ASOCKS API response:", chalk.yellow, logger);
      logWithDedup(
        "debug",
        JSON.stringify(response.data, null, 2),
        chalk.gray,
        logger
      );
      throw new Error(
        response.data?.message ||
          `API returned success: ${response.data?.success}, but no proxy data found`
      );
    }
  } catch (error) {
    logger?.error("Failed to generate proxy via ASOCKS API", {
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
    });

    if (error.response?.status === 401 || error.response?.status === 403) {
      logWithDedup(
        "error",
        "❌ ASOCKS API authentication failed - check your API key",
        chalk.red,
        logger
      );
    } else if (error.response?.status === 429) {
      logWithDedup(
        "error",
        "❌ ASOCKS API rate limit exceeded - try again later",
        chalk.red,
        logger
      );
    } else if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      logWithDedup(
        "error",
        "❌ Unable to connect to ASOCKS API - check your internet connection",
        chalk.red,
        logger
      );
    } else if (error.response?.data) {
      logWithDedup(
        "error",
        `❌ ASOCKS API error: ${JSON.stringify(error.response.data)}`,
        chalk.red,
        logger
      );
    } else {
      logWithDedup(
        "error",
        `❌ ASOCKS API error: ${error.message}`,
        chalk.red,
        logger
      );
    }

    logWithDedup(
      "warning",
      "⚠️ Falling back to manual CAPTCHA mode",
      chalk.yellow,
      logger
    );
    return null;
  }
}

/**
 * Delete a proxy through ASOCKS API
 * @param {string} proxyId - ID of the proxy to delete
 * @param {Object} logger - Winston logger instance
 * @returns {Promise<boolean>} Success status
 */
async function deleteProxy(proxyId, logger = null) {
  // Check if we have a real proxy service configured
  if (!ASOCKS_CONFIG.apiKey) {
    logger?.debug("No proxy service configured - skipping proxy deletion");
    return true;
  }

  try {
    logger?.debug("Attempting to delete proxy via ASOCKS API", { proxyId });
    logWithDedup(
      "info",
      `🗑️ Deleting proxy ${proxyId} via ASOCKS API...`,
      chalk.blue,
      logger
    );

    // ASOCKS API delete-port endpoint
    const response = await axios.delete(
      `https://api.asocks.com/v2/proxy/delete-port?apiKey=${ASOCKS_CONFIG.apiKey}&id=${proxyId}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        timeout: 10000, // 10 second timeout
      }
    );

    if (
      response.status === 200 ||
      response.status === 204 ||
      (response.data && response.data.success === true)
    ) {
      logger?.info("Successfully deleted proxy via ASOCKS API", { proxyId });
      logWithDedup(
        "info",
        `✅ Proxy ${proxyId} deleted successfully`,
        chalk.green,
        logger
      );
      return true;
    } else {
      throw new Error(
        response.data?.message ||
          response.data?.error ||
          "Failed to delete proxy"
      );
    }
  } catch (error) {
    logger?.error("Failed to delete proxy via ASOCKS API", {
      error: error.message,
      proxyId,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
    });

    if (error.response?.status === 401 || error.response?.status === 403) {
      logWithDedup(
        "error",
        "❌ ASOCKS API authentication failed during proxy deletion",
        chalk.red,
        logger
      );
    } else if (error.response?.status === 404) {
      logWithDedup(
        "warn",
        `⚠️ Proxy ${proxyId} not found (may already be deleted)`,
        chalk.yellow,
        logger
      );
      return true; // Consider it successful if already deleted
    } else if (error.response?.data) {
      logWithDedup(
        "error",
        `❌ Failed to delete proxy ${proxyId}: ${JSON.stringify(
          error.response.data
        )}`,
        chalk.red,
        logger
      );
    } else {
      logWithDedup(
        "error",
        `❌ Failed to delete proxy ${proxyId}: ${error.message}`,
        chalk.red,
        logger
      );
    }

    // Don't fail the entire process if proxy deletion fails
    return false;
  }
}

// Export state for testing purposes
const getApiState = () => ({ ASOCKS_API_TESTED, ASOCKS_API_WORKS });
const resetApiState = () => {
  ASOCKS_API_TESTED = false;
  ASOCKS_API_WORKS = false;
};

export {
  testAsocksAPI,
  generateProxy,
  deleteProxy,
  getApiState,
  resetApiState,
};
