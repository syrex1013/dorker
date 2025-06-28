import randomUseragent from "random-useragent";

// Enhanced Advanced Fingerprinting Utilities
const generateUniqueFingerprint = () => {
  try {
    // Generate unique seed based on current time and random values
    const seed = Date.now() + Math.random() * 1000000;
    const seedRandom = (index) => {
      const x = Math.sin(seed + index) * 10000;
      return x - Math.floor(x);
    };

    // Parse real user agent for realistic values
    const realUA = randomUseragent.getRandom();

    // Enhanced screen resolutions with more realistic variations
    const screens = [
      { width: 1920, height: 1080, deviceScaleFactor: 1 },
      { width: 1920, height: 1080, deviceScaleFactor: 1.25 },
      { width: 1920, height: 1080, deviceScaleFactor: 1.5 },
      { width: 2560, height: 1440, deviceScaleFactor: 1 },
      { width: 2560, height: 1440, deviceScaleFactor: 1.5 },
      { width: 3840, height: 2160, deviceScaleFactor: 1.5 },
      { width: 3840, height: 2160, deviceScaleFactor: 2 },
      { width: 1366, height: 768, deviceScaleFactor: 1 },
      { width: 1536, height: 864, deviceScaleFactor: 1.25 },
      { width: 1440, height: 900, deviceScaleFactor: 1 },
      { width: 1440, height: 900, deviceScaleFactor: 2 }, // Retina
      { width: 1680, height: 1050, deviceScaleFactor: 1 },
      { width: 1280, height: 800, deviceScaleFactor: 1 },
      { width: 1280, height: 720, deviceScaleFactor: 1 },
      // Add more modern resolutions
      { width: 2880, height: 1800, deviceScaleFactor: 2 }, // MacBook Pro 16"
      { width: 3456, height: 2234, deviceScaleFactor: 2 }, // MacBook Pro 14"
      { width: 2736, height: 1824, deviceScaleFactor: 2 }, // Surface Studio
      { width: 1920, height: 1200, deviceScaleFactor: 1 }, // 16:10 monitor
      { width: 3440, height: 1440, deviceScaleFactor: 1 }, // Ultrawide
      { width: 2560, height: 1080, deviceScaleFactor: 1 }, // Ultrawide 21:9
    ];

    // Select random values with unique seeding
    const screen = screens[Math.floor(seedRandom(1) * screens.length)];

    // Return enhanced fingerprint
    return {
      visitorId: seed.toString(36),
      screen,
      userAgent: realUA,
      // Add more unique characteristics...
      sessionId: seed.toString() + "_" + Date.now(),
      touchSupport: seedRandom(2) > 0.7,
      colorDepth: [24, 32][Math.floor(seedRandom(3) * 2)],
      pixelDepth: [24, 32][Math.floor(seedRandom(4) * 2)],
      hardwareConcurrency: [4, 6, 8, 12, 16][Math.floor(seedRandom(5) * 5)],
      deviceMemory: [4, 8, 16, 32][Math.floor(seedRandom(6) * 4)],
      languages: [
        ["en-US", "en"],
        ["en-GB", "en"],
      ][Math.floor(seedRandom(7) * 2)],
      timezone: ["America/New_York", "America/Los_Angeles", "Europe/London"][
        Math.floor(seedRandom(8) * 3)
      ],
      platform: realUA.includes("Mac")
        ? "MacIntel"
        : realUA.includes("Windows")
        ? "Win32"
        : "Linux x86_64",
      // Enhanced canvas fingerprinting
      canvas: {
        noise: seedRandom(9) * 0.001,
        textBaseline: ["top", "bottom", "middle", "alphabetic"][
          Math.floor(seedRandom(10) * 4)
        ],
        fillStyle: `rgba(${Math.floor(seedRandom(11) * 255)}, ${Math.floor(
          seedRandom(12) * 255
        )}, ${Math.floor(seedRandom(13) * 255)}, 0.1)`,
        globalCompositeOperation: ["source-over", "multiply", "screen"][
          Math.floor(seedRandom(14) * 3)
        ],
        shadowBlur: Math.floor(seedRandom(15) * 10),
        shadowColor: `rgba(${Math.floor(seedRandom(16) * 255)}, ${Math.floor(
          seedRandom(17) * 255
        )}, ${Math.floor(seedRandom(18) * 255)}, 0.5)`,
        lineWidth: seedRandom(19) * 3 + 1,
        lineCap: ["butt", "round", "square"][Math.floor(seedRandom(20) * 3)],
        lineJoin: ["miter", "round", "bevel"][Math.floor(seedRandom(21) * 3)],
      },
      // Enhanced WebGL fingerprinting
      webgl: {
        vendor: "Google Inc. (Intel)",
        renderer: `ANGLE (Intel, Mesa Intel(R) HD Graphics ${
          Math.floor(seedRandom(22) * 999) + 500
        } (Gen8 GT2), OpenGL 4.6)`,
        maxTextureSize: [4096, 8192, 16384][Math.floor(seedRandom(23) * 3)],
        maxViewportDims: [16384, 32768][Math.floor(seedRandom(24) * 2)],
        maxCombinedTextureImageUnits: [32, 64, 80, 96][
          Math.floor(seedRandom(25) * 4)
        ],
        maxVertexTextureImageUnits: [16, 32][Math.floor(seedRandom(26) * 2)],
        maxTextureImageUnits: [16, 32][Math.floor(seedRandom(27) * 2)],
        depthBits: [24, 32][Math.floor(seedRandom(28) * 2)],
        stencilBits: [0, 8][Math.floor(seedRandom(29) * 2)],
      },
      // Enhanced unique identifiers
      clientRectsNoise: seedRandom(30) * 0.0001,
      cookiesEnabled: true,
      doNotTrack: ["1", "0", null][Math.floor(seedRandom(31) * 3)],
      maxTouchPoints:
        seedRandom(2) > 0.7 ? Math.floor(seedRandom(32) * 5) + 1 : 0,
      performanceTiming: {
        navigationStart: Date.now() - Math.floor(seedRandom(33) * 5000),
        loadEventEnd: Date.now() - Math.floor(seedRandom(34) * 1000),
      },
    };
  } catch (error) {
    // Fallback to basic unique fingerprint
    const fallbackSeed = Date.now() + Math.random() * 1000;
    return {
      visitorId: fallbackSeed.toString(36),
      screen: { width: 1920, height: 1080, deviceScaleFactor: 1 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      sessionId: fallbackSeed.toString() + "_fallback",
      touchSupport: false,
      colorDepth: 24,
      pixelDepth: 24,
      hardwareConcurrency: 8,
      deviceMemory: 8,
      languages: ["en-US", "en"],
      timezone: "America/New_York",
      platform: "Win32",
    };
  }
};

export { generateUniqueFingerprint as generateFingerprint };
