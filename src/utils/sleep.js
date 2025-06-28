// Maximum sleep duration in milliseconds (60 seconds)
const MAX_SLEEP_MS = 60000;

/**
 * Sleep for a specified number of milliseconds (capped at 60 seconds)
 * Background monitors continue to run during sleep
 * @param {number} ms - Milliseconds to sleep
 * @param {string} context - Context for logging (optional)
 * @param {Object} logger - Logger instance (optional)
 * @returns {Promise} Promise that resolves after the delay
 */
const sleep = (ms, context = "", logger = null) => {
  // Cap sleep duration at 60 seconds
  const cappedMs = Math.min(ms, MAX_SLEEP_MS);

  if (cappedMs !== ms && logger) {
    logger.debug(
      `Sleep capped: requested ${ms}ms, using ${cappedMs}ms (max 60s)${
        context ? ` (${context})` : ""
      }`
    );
  } else if (logger) {
    logger.debug(`Sleep: ${cappedMs}ms${context ? ` (${context})` : ""}`);
  }

  return new Promise((resolve) => setTimeout(resolve, cappedMs));
};

/**
 * Generate a random delay between min and max milliseconds (capped at 60 seconds)
 * @param {number} min - Minimum delay in milliseconds
 * @param {number} max - Maximum delay in milliseconds
 * @returns {number} Random delay value
 */
const randomDelay = (min = 500, max = 2000) => {
  // Cap both min and max at 60 seconds
  const cappedMin = Math.min(min, MAX_SLEEP_MS);
  const cappedMax = Math.min(max, MAX_SLEEP_MS);

  return Math.floor(Math.random() * (cappedMax - cappedMin + 1)) + cappedMin;
};

/**
 * Human-like delay with variations and pauses (capped at 60 seconds)
 * @param {number} baseDelay - Base delay in milliseconds
 * @param {number} maxPause - Maximum pause length in milliseconds
 * @param {Object} logger - Logger instance
 */
const humanDelay = async (baseDelay, maxPause, logger = null) => {
  // Cap all components at reasonable values
  const cappedBaseDelay = Math.min(baseDelay, MAX_SLEEP_MS);
  const cappedMaxPause = Math.min(maxPause, MAX_SLEEP_MS);

  const humanVariation = randomDelay(5000, Math.min(15000, MAX_SLEEP_MS / 4)); // Max 15s variation
  const thinkingTime = Math.min(Math.random() * 8000 + 3000, MAX_SLEEP_MS / 6); // Max ~10s thinking

  let totalDelay = cappedBaseDelay + humanVariation + thinkingTime;

  // Ensure total delay doesn't exceed maxPause or 60 seconds
  if (totalDelay > cappedMaxPause) {
    totalDelay = cappedMaxPause;
  }

  // Final cap at 60 seconds
  totalDelay = Math.min(totalDelay, MAX_SLEEP_MS);

  if (logger) {
    logger.debug(
      `Human delay: ${Math.round(
        totalDelay / 1000
      )}s (base: ${cappedBaseDelay}ms, variation: ${humanVariation}ms, thinking: ${Math.round(
        thinkingTime
      )}ms)`
    );
  }

  await sleep(totalDelay, "human-like delay", logger);
};

export { sleep, randomDelay, humanDelay, MAX_SLEEP_MS };
