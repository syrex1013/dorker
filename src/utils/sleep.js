/**
 * Sleep for a specified number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @param {string} context - Context for logging (optional)
 * @param {Object} logger - Logger instance (optional)
 * @returns {Promise} Promise that resolves after the delay
 */
const sleep = (ms, context = "", logger = null) => {
  if (logger) {
    logger.debug(`Sleep: ${ms}ms${context ? ` (${context})` : ""}`);
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Generate a random delay between min and max milliseconds
 * @param {number} min - Minimum delay in milliseconds
 * @param {number} max - Maximum delay in milliseconds
 * @returns {number} Random delay value
 */
const randomDelay = (min = 500, max = 2000) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

/**
 * Human-like delay with variations and pauses
 * @param {number} baseDelay - Base delay in milliseconds
 * @param {number} maxPause - Maximum pause length in milliseconds
 * @param {Object} logger - Logger instance
 */
const humanDelay = async (baseDelay, maxPause, logger = null) => {
  const humanVariation = randomDelay(5000, 15000);
  const thinkingTime = Math.random() * 8000 + 3000;

  let totalDelay = baseDelay + humanVariation + thinkingTime;

  if (totalDelay > maxPause) {
    totalDelay = maxPause;
  }

  if (logger) {
    logger.debug(
      `Human delay: ${Math.round(
        totalDelay / 1000
      )}s (base: ${baseDelay}ms, variation: ${humanVariation}ms, thinking: ${Math.round(
        thinkingTime
      )}ms)`
    );
  }

  await sleep(totalDelay);
};

export { sleep, randomDelay, humanDelay };
