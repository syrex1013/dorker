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

// Browser configuration to avoid CAPTCHA detection
const BROWSER_CONFIG = {
  headless: process.env.HEADLESS === "true" ? true : false, // Default to visible browser
  loadImages: true, // Loading images helps avoid detection
  useProxy: true, // Use proxy rotation to avoid IP-based detection
  useRandomUserAgent: true, // Randomize user agent
  extraStealthOptions: {
    enableWebGL: true, // Enable WebGL for better fingerprinting resistance
    enableAudio: true, // Enable audio context
    useHardwareAcceleration: true, // Use hardware acceleration
    useExtraFingerprinting: true, // Use extra fingerprinting protection
  },
  // Warmup settings
  warmup: {
    enabled: true,
    minDuration: 30000, // 30 seconds minimum
    maxDuration: 60000, // 60 seconds maximum
  },
  // Proxy rotation settings
  proxyRotation: {
    rotateOnCaptcha: true,
    rotateAfterSearches: 3, // Rotate proxy after 3 searches
  },
  // Movement settings
  movements: {
    enabled: true, // Enable random mouse movements by default
    disableOnFast: false, // Can be overridden by CLI flag
  }
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
  BROWSER_CONFIG,
};
