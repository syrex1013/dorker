import { connect } from "puppeteer-real-browser";
import chalk from "chalk";
import { generateFingerprint } from "../src/utils/fingerprint.js";

async function testPagination() {
  console.log(chalk.blue.bold("🧪 Real Browser Pagination Test with Real Queries"));
  console.log("─".repeat(60));

  const { browser } = await connect({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-features=AutomationControlled",
    ],
    turnstile: true,
    disableXvfb: false,
    ignoreHTTPSErrors: true,
  });

  const queryText = "site:example.com"; // Use query that user expects and yields many results
  const engines = {
    google: {
      url: `https://www.google.com/`,
      searchBox: ["input[name=\"q\"]", "#APjFqb", ".gLFyf"],
      nextSelector: 'a[aria-label="Next page"]',
      resultsSelector: "div.g",
    },
    bing: {
      url: `https://www.bing.com/`,
      searchBox: ["#sb_form_q", "input[name=\"q\"]", "#search_box"],
      nextSelector: "a.sb_pagN",
      resultsSelector: "li.b_algo",
    },
    duckduckgo: {
      url: `https://duckduckgo.com/`,
      searchBox: ["#search_form_input_homepage", "#search_form_input", "input[name=\"q\"]"],
      selectorOptions: [
        "a.result--more__btn",
        "a.result--more__btn__floating",
        "a.next",
      ],
      resultsSelector: "div.results > div.result",
    },
  };

  let allPassed = true;

  for (const [engineName, cfg] of Object.entries(engines)) {
    const page = await browser.newPage();
    const fp = generateFingerprint();
    await page.setUserAgent(fp.userAgent);
    const { width, height, deviceScaleFactor } = fp.screen;
    await page.setViewport({ width, height, deviceScaleFactor });

    try {
      await page.goto(cfg.url, { waitUntil: "domcontentloaded", timeout: 60000 });

      // Submit the search via the search box (ensures Bing actually executes the query)
      if (cfg.searchBox && cfg.searchBox.length) {
        let box = null;
        for (const sel of cfg.searchBox) {
          try {
            await page.waitForSelector(sel, { timeout: 5000 });
            box = await page.$(sel);
            if (box) break;
          } catch (_) {
            /* ignore */
          }
        }

        if (!box) throw new Error("Search box not found");

        await box.click({ clickCount: 3 }); // focus & select all
        await page.keyboard.type(queryText);

        // Submit search – try Enter twice (Google sometimes needs two) and fall back to explicit buttons
        const trySubmitSearch = async () => {
          await page.keyboard.press("Enter");
          // Wait briefly for any result containers to appear (no full navigation dependency)
          const appeared = await page.waitForSelector(cfg.resultsSelector, { timeout: 8000 }).then(() => true).catch(() => false);
          return appeared;
        };

        let searchSuccess = await trySubmitSearch();

        if (!searchSuccess) {
          // Second Enter attempt
          searchSuccess = await trySubmitSearch();
        }

        if (!searchSuccess && engineName === "bing") {
          // Click Bing search button
          const btn = await page.$("#sb_form_go");
          if (btn) {
            await btn.click();
            searchSuccess = await page.waitForSelector(cfg.resultsSelector, { timeout: 8000 }).then(() => true).catch(() => false);
          } else {
            //Enter click
            await page.keyboard.press("Enter");
            searchSuccess = await page.waitForSelector(cfg.resultsSelector, { timeout: 8000 }).then(() => true).catch(() => false);
          }
        }

        if (!searchSuccess && engineName === "duckduckgo") {
          // Click DuckDuckGo magnifier button if exists
          const btn = await page.$("#search_button_homepage, button[type=submit]");
          if (btn) {
            await btn.click();
            searchSuccess = await page.waitForSelector(cfg.resultsSelector, { timeout: 8000 }).then(() => true).catch(() => false);
          } else {
            //Enter click
            await page.keyboard.press("Enter");
            searchSuccess = await page.waitForSelector(cfg.resultsSelector, { timeout: 8000 }).then(() => true).catch(() => false);
          }
        }

        if (!searchSuccess) throw new Error("Search submission failed");
      }

      // At this point results should be present (already checked but ensure)
      await page.waitForSelector(cfg.resultsSelector, { timeout: 15000 });

      // Count initial results and log URLs found
      const initialResults = await page.$$eval(cfg.resultsSelector, (els) => {
        return els.map((el, index) => {
          const link = el.querySelector('a[href^="http"]');
          return {
            index: index + 1,
            url: link ? link.href : 'no-url',
            title: link ? link.textContent.trim().substring(0, 50) : 'no-title'
          };
        });
      });

      const initialCount = initialResults.length;
      console.log(`${engineName} initial results (${initialCount}):`);
      initialResults.forEach(result => {
        console.log(`  ${result.index}. ${result.url} - "${result.title}"`);
      });

      if (engineName === "duckduckgo") {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      }

      let nextSelector = cfg.nextSelector || null;
      if (!nextSelector && cfg.selectorOptions) {
        for (const sel of cfg.selectorOptions) {
          const exists = await page.$(sel);
          if (exists) {
            nextSelector = sel;
            break;
          }
        }
      }

      if (!nextSelector) throw new Error("No next button selector found!");

      const nextButton = await page.$(nextSelector);
      if (!nextButton) throw new Error("Next button not found!");

      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }),
        nextButton.click(),
      ]);

      // Wait for new results to appear
      await page.waitForSelector(cfg.resultsSelector, { timeout: 15000 });

      // Count results after pagination and log URLs found
      const newResults = await page.$$eval(cfg.resultsSelector, (els) => {
        return els.map((el, index) => {
          const link = el.querySelector('a[href^="http"]');
          return {
            index: index + 1,
            url: link ? link.href : 'no-url',
            title: link ? link.textContent.trim().substring(0, 50) : 'no-title'
          };
        });
      });

      const newCount = newResults.length;
      console.log(`${engineName} after pagination results (${newCount}):`);
      newResults.forEach(result => {
        console.log(`  ${result.index}. ${result.url} - "${result.title}"`);
      });

      const passed = newCount !== initialCount && newCount > 0;
      console.log(
        passed
          ? chalk.green(`✅ ${engineName} pagination passed (${initialCount} -> ${newCount} results)`)
          : chalk.red(`❌ ${engineName} pagination failed (no new results)`)
      );

      if (!passed) allPassed = false;
    } catch (err) {
      console.log(chalk.red(`❌ ${engineName} pagination error:`), err.message);
      allPassed = false;
    } finally {
      await page.close();
    }
  }

  await browser.close();
  process.exit(allPassed ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testPagination().catch((e) => {
    console.error(chalk.red("Pagination test crashed:"), e);
    process.exit(1);
  });
}
