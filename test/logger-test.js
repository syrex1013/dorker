import { expect } from "chai";
import { describe, it, before } from "mocha";
import fs from "fs";
import path from "path";
import { createLogger, logWithDedup, clearPreviousLogs } from "../src/utils/logger.js";

describe("Logger", function () {
  const logsDir = path.join(process.cwd(), "logs");
  const logFilePath = path.join(logsDir, "application.log");
  let logger;

  before(async function () {
    // Ensure fresh logs
    await clearPreviousLogs(logsDir);
    logger = await createLogger();
  });

  it("should write messages into application.log", function (done) {
    const testMsg = "Test log entry";
    logger.info(testMsg);
    // Wait a bit for async write
    setTimeout(() => {
      const data = fs.readFileSync(logFilePath, "utf8");
      expect(data).to.include(testMsg);
      done();
    }, 200);
  });

  it("should deduplicate console output", function () {
    // Capture console
    let count = 0;
    const originalLog = console.log;
    console.log = () => count++;

    logWithDedup("info", "duplicate-message", null, logger, true);
    logWithDedup("info", "duplicate-message", null, logger, true);

    console.log = originalLog;
    expect(count).to.equal(1);
  });
}); 