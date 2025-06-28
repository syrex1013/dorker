#!/usr/bin/env node

/**
 * Dorker - Google Dorking Tool with Advanced Anti-Detection
 *
 * This is the main entry point that uses the new modular architecture.
 * All functionality has been organized into professional modules in the src/ directory.
 */

import { main } from "./src/main.js";

// Simply call the modular main function
main().catch((error) => {
  console.error(`❌ Application failed to start: ${error.message}`);
  process.exit(1);
});
