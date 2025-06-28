import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Configuration Objects
const ASOCKS_CONFIG = {
  apiKey: process.env.ASOCKS_API_KEY || null,
};

const OPENROUTER_CONFIG = {
  apiKey:
    process.env.OPENROUTER_API_KEY ||
    "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",
};

// Cache configurations
const CONSOLE_LOG_CACHE_CONFIG = {
  maxSize: 100,
};

export { ASOCKS_CONFIG, OPENROUTER_CONFIG, CONSOLE_LOG_CACHE_CONFIG };
