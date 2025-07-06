import { expect } from "chai";
import { describe, it } from "mocha";
import { MultiEngineDorker } from "../src/dorker/MultiEngineDorker.js";

// Mock logger
const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("Dork filtering", function () {
  it("should filter results that do not match dork patterns when enabled", function () {
    const config = { dorkFiltering: true };
    const dorker = new MultiEngineDorker(config, logger);

    const dork = "site:example.com ext:pdf password";

    // Mock results
    const results = [
      { url: "https://example.com/report.pdf", title: "Annual report", description: "password: 1234" },
      { url: "https://example.com/public.html", title: "Public page", description: "welcome" },
    ];

    const filtered = dorker.filterResultsByDork(results, dork);

    expect(filtered.length).to.equal(1);
    expect(filtered[0].url).to.include("report.pdf");
  });

  it("should return original results list when filtering disabled", function () {
    const config = { dorkFiltering: false };
    const dorker = new MultiEngineDorker(config, logger);

    const dork = "site:example.com";
    const results = [
      { url: "https://example.com/page.html", title: "Page", description: "text" },
    ];

    const filtered = dorker.filterResultsByDork(results, dork);

    expect(filtered.length).to.equal(results.length);
  });
}); 