import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Configuration Objects
const ASOCKS_CONFIG = {
  apiKey: process.env.ASOCKS_API_KEY || null,
};

const OPENROUTER_CONFIG = {
  apiKey: process.env.OPENROUTER_API_KEY || null,
};

const ELEVENLABS_CONFIG = {
  apiKey: process.env.ELEVENLABS_API_KEY || null,
};

const OPENAI_CONFIG = {
  apiKey: process.env.OPENAI_API_KEY || null,
};

// Cache configurations
const CONSOLE_LOG_CACHE_CONFIG = {
  maxSize: 100,
};

export {
  ASOCKS_CONFIG,
  OPENROUTER_CONFIG,
  ELEVENLABS_CONFIG,
  OPENAI_CONFIG,
  CONSOLE_LOG_CACHE_CONFIG,
};
