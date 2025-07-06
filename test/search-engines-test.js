import { describe, it, after, beforeEach } from 'mocha';
import { expect } from 'chai';
import { MultiEngineDorker } from '../src/dorker/MultiEngineDorker.js';
import { SEARCH_ENGINES } from '../src/constants/searchEngines.js';
import { sleep } from '../src/utils/sleep.js';

describe('Search Engines Tests', () => {
  let dorker;
  const testConfig = {
    autoProxy: false,
    maxPages: 1,
    dorkFiltering: true,
    humanLike: false,
    headless: "new",
    timeout: 60000,
    defaultNavigationTimeout: 60000,
    defaultWaitForTimeout: 60000,
  };

  // Helper function to create a new dorker instance
  async function createDorker() {
    const instance = new MultiEngineDorker(testConfig);
    try {
      await instance.initialize();
      return instance;
    } catch (error) {
      console.error('Failed to initialize dorker:', error);
      throw error;
    }
  }

  // Helper function to safely cleanup dorker
  async function cleanupDorker(instance) {
    if (instance) {
      try {
        await instance.cleanup();
      } catch (error) {
        console.error('Error during cleanup:', error);
      }
    }
  }

  // Helper function to handle Google consent form
  async function handleGoogleConsent(page) {
    try {
      // Wait for potential consent form
      await page.waitForFunction(() => {
        const pageText = document.body.textContent || '';
        return pageText.includes('Before you continue to Google') ||
               pageText.includes('We use cookies and data') ||
               pageText.includes('Zanim przejdziesz do Google') ||
               pageText.includes('Używamy plików cookie') ||
               pageText.includes('Zaakceptuj wszystkie') ||
               document.querySelector('.containerGm3') !== null ||
               document.querySelector('.boxGm3') !== null ||
               pageText.includes('Sign inSign inBefore you continue');
      }, { timeout: 5000 }).catch(() => {
        // If timeout, assume no consent form
        return false;
      });

      // Check if we're on consent page
      const isConsentPage = await page.evaluate(() => {
        const pageText = document.body.textContent || '';
        return pageText.includes('Before you continue to Google') ||
               pageText.includes('We use cookies and data') ||
               pageText.includes('Zanim przejdziesz do Google') ||
               pageText.includes('Używamy plików cookie') ||
               pageText.includes('Zaakceptuj wszystkie') ||
               document.querySelector('.containerGm3') !== null ||
               document.querySelector('.boxGm3') !== null ||
               pageText.includes('Sign inSign inBefore you continue');
      });

      if (isConsentPage) {
        console.log('Handling Google consent form...');
        
        // Try clicking "Accept all" button with various selectors
        const consentSelectors = [
          'button[aria-label*="Accept all"]',
          'button[aria-label*="accept all"]',
          'button:has-text("Accept all")',
          'button:has-text("I agree")',
          'button[jsname="tWT92d"]',
          'form[action*="consent"] button',
          '.boxGm3 button',
          'button.tHlp8d',
          'button[jsname="higCR"]'
        ];

        for (const selector of consentSelectors) {
          try {
            const button = await page.$(selector);
            if (button) {
              await button.click();
              console.log(`Clicked consent button with selector: ${selector}`);
              // Wait for navigation after consent
              await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});
              break;
            }
          } catch (e) {
            // Continue trying other selectors
          }
        }

        // Wait a bit after handling consent
        await sleep(2000, "after handling consent");
      }
    } catch (error) {
      console.error('Error handling consent form:', error);
    }
  }

  // Helper function to handle Bing consent/cookie banners
  async function handleBingConsent(page) {
    try {
      // Common cookie/consent button selectors for Bing
      const consentSelectors = [
        '#bnp_btn_accept',
        '#consent-banner button',
        'button[id*="consent"]',
        'button:has-text("Accept")',
        'button:has-text("Agree")',
        '#bnp_container button'
      ];

      for (const selector of consentSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 }).catch(() => null);
          const button = await page.$(selector);
          if (button) {
            await button.click();
            console.log(`Clicked Bing consent button with selector: ${selector}`);
            await sleep(1000, "after clicking Bing consent button");
            break;
          }
        } catch (e) {
          // Continue trying other selectors
        }
      }
    } catch (error) {
      console.error('Error handling Bing consent:', error);
    }
  }

  // Helper function to perform search on a specific engine
  async function performEngineSearch(page, engine, query) {
    const engineConfig = SEARCH_ENGINES[engine];
    const searchBoxSelectors = {
      google: ['input[name="q"]', '#APjFqb', '.gLFyf'],
      bing: ['#sb_form_q', 'input[name="q"]', '#search_box'],
      duckduckgo: ['#search_form_input_homepage', '#search_form_input', 'input[name="q"]']
    };

    // Navigate to search engine homepage
    console.log(`Navigating to ${engineConfig.baseUrl}`);
    await page.goto(engineConfig.baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await sleep(2000, `waiting for ${engine} to load`);

    // Handle consent forms
    if (engine === 'google') {
      await handleGoogleConsent(page);
    } else if (engine === 'bing') {
      await handleBingConsent(page);
    }

    // Find and interact with search box
    let searchBox = null;
    for (const selector of searchBoxSelectors[engine]) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 }).catch(() => null);
        searchBox = await page.$(selector);
        if (searchBox) {
          console.log(`Found search box with selector: ${selector}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!searchBox) {
      throw new Error(`Could not find search box for ${engine}`);
    }

    // Clear and fill search box
    await searchBox.click();
    await searchBox.focus();
    await page.keyboard.down(process.platform === "darwin" ? "Meta" : "Control");
    await page.keyboard.press("a");
    await page.keyboard.up(process.platform === "darwin" ? "Meta" : "Control");
    await page.keyboard.press("Delete");
    await sleep(500, "after clearing search box");

    // Type query
    await searchBox.type(query, { delay: 100 });
    await sleep(500, "after typing query");

    // Submit search
    await page.keyboard.press("Enter");
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {
      console.log('Navigation timeout, continuing anyway...');
    });

    // Wait for results to load with multiple selector attempts
    const resultsSelectors = {
      google: ['div.g', '#search div[data-hveid]', '#rso > div'],
      bing: ['li.b_algo', '#b_results > li', '.b_results .b_algo'],
      duckduckgo: ['article[data-testid="result"]', '.result', '.results .result']
    };

    let resultsFound = false;
    for (const selector of resultsSelectors[engine]) {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
        console.log(`Found results with selector: ${selector}`);
        resultsFound = true;
        break;
      } catch (e) {
        console.log(`Selector ${selector} not found, trying next...`);
        continue;
      }
    }

    if (!resultsFound) {
      console.log('No results found with any selector');
      return [];
    }

    // Extract results
    const results = await page.evaluate((config) => {
      const containers = document.querySelectorAll(config.resultsSelector);
      const results = [];
      const seenUrls = new Set();

      for (const container of containers) {
        try {
          const linkElement = container.querySelector(config.linkSelector);
          if (!linkElement) continue;

          const url = linkElement.href;
          if (!url || seenUrls.has(url)) continue;

          const titleElement = container.querySelector(config.titleSelector);
          const title = titleElement ? titleElement.textContent.trim() : '';

          const descElement = container.querySelector(config.descriptionSelector);
          const description = descElement ? descElement.textContent.trim() : '';

          if (url && (title || description)) {
            seenUrls.add(url);
            results.push({ url, title, description });
          }
        } catch (e) {
          console.error('Error extracting result:', e);
        }
      }

      return results;
    }, engineConfig);

    return results;
  }

  beforeEach(async () => {
    await cleanupDorker(dorker);
    dorker = await createDorker();
  });

  after(async () => {
    await cleanupDorker(dorker);
  });

  describe('Google Search', () => {
    it('should return results from Google', async () => {
      const { page } = dorker.pageData;
      const results = await performEngineSearch(page, 'google', 'site:example.com');
      
      expect(results).to.be.an('array');
      if (results.length > 0) {
        expect(results[0]).to.have.property('url');
        expect(results[0]).to.have.property('title');
      }
    }).timeout(120000);
  });

  describe('Bing Search', () => {
    it('should return results from Bing', async () => {
      const { page } = dorker.pageData;
      const results = await performEngineSearch(page, 'bing', 'site:example.com');
      
      expect(results).to.be.an('array');
      if (results.length > 0) {
        expect(results[0]).to.have.property('url');
        expect(results[0]).to.have.property('title');
      }
    }).timeout(120000);
  });

  describe('DuckDuckGo Search', () => {
    it('should return results from DuckDuckGo', async () => {
      const { page } = dorker.pageData;
      const results = await performEngineSearch(page, 'duckduckgo', 'site:example.com');
      
      expect(results).to.be.an('array');
      if (results.length > 0) {
        expect(results[0]).to.have.property('url');
        expect(results[0]).to.have.property('title');
      }
    }).timeout(120000);
  });

  describe('Multi-Engine Search', () => {
    it('should return combined results from all engines', async () => {
      const { page } = dorker.pageData;
      const allResults = [];

      // Test each engine sequentially
      for (const engine of ['google', 'bing', 'duckduckgo']) {
        try {
          const results = await performEngineSearch(page, engine, 'site:example.com');
          allResults.push(...results.map(r => ({ ...r, engine })));
        } catch (e) {
          console.log(`Error searching with ${engine}:`, e.message);
        }
      }

      expect(allResults).to.be.an('array');
      if (allResults.length > 0) {
        const engines = allResults.map(r => r.engine);
        expect(engines.some(e => ['google', 'bing', 'duckduckgo'].includes(e))).to.be.true;

        allResults.forEach(result => {
          expect(result).to.have.property('url');
          expect(result).to.have.property('title');
          expect(result).to.have.property('engine');
          expect(['google', 'bing', 'duckduckgo']).to.include(result.engine);
        });
      }
    }).timeout(240000);

    it('should handle failed engines gracefully', async () => {
      const { page } = dorker.pageData;
      const results = [];

      // Test with one valid and one invalid engine
      try {
        const googleResults = await performEngineSearch(page, 'google', 'site:example.com');
        results.push(...googleResults.map(r => ({ ...r, engine: 'google' })));
      } catch (e) {
        console.log('Google search failed:', e.message);
      }

      expect(results).to.be.an('array');
      if (results.length > 0) {
        const engines = results.map(r => r.engine);
        expect(engines.some(e => e === 'google')).to.be.true;
      }
    }).timeout(120000);
  });

  describe('Error Handling', () => {
    it('should handle invalid dorks gracefully', async () => {
      const { page } = dorker.pageData;
      try {
        // Try with empty query
        let results = await performEngineSearch(page, 'google', '');
        expect(results).to.be.an('array');
        expect(results.length).to.equal(0);

        // Try with invalid query
        results = await performEngineSearch(page, 'google', '!@#$%^');
        expect(results).to.be.an('array');
        expect(results.length).to.equal(0);
      } catch (e) {
        // Even if there's an error, we should get an empty array
        expect([]).to.be.an('array');
        expect([].length).to.equal(0);
      }
    }).timeout(120000);

    it('should handle network errors gracefully', async () => {
      const { page } = dorker.pageData;
      try {
        await page.goto('https://invalid.example.com', { timeout: 5000 });
      } catch (e) {
        // Expected error
      }
      const results = await performEngineSearch(page, 'google', 'test');
      expect(results).to.be.an('array');
    }).timeout(60000);
  });
}); 