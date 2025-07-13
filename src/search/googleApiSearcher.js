import axios from 'axios';
import { JSDOM } from 'jsdom';
import { createLogger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';
import chalk from 'chalk';

/**
 * Google API Searcher
 * Performs Google searches using direct HTTP requests instead of browser automation
 */
export class GoogleApiSearcher {
    constructor(config = {}) {
        this.config = {
            delay: config.delay || 2000,
            maxRetries: config.maxRetries || 3,
            timeout: config.timeout || 30000,
            userAgent: config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            proxy: config.proxy || null,
            maxResults: config.maxResults || 30,
            ...config
        };
        
        this.logger = null;
        this.searchCount = 0;
        this.blocked = false;
        
        // Create axios instance with default configuration
        this.httpClient = axios.create({
            timeout: this.config.timeout,
            headers: {
                'User-Agent': this.config.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Cache-Control': 'max-age=0'
            }
        });
        
        // Add proxy if configured
        if (this.config.proxy) {
            this.httpClient.defaults.proxy = this.config.proxy;
        }
    }
    
    /**
     * Initialize the Google API searcher
     */
    async initialize() {
        try {
            this.logger = await createLogger(false);
            this.logger.info('Initializing Google API searcher');
            
            console.log(chalk.blue('🔍 Google API Searcher Initialized'));
            console.log(chalk.gray(`Delay: ${this.config.delay}ms between requests`));
            console.log(chalk.gray(`Max Results: ${this.config.maxResults} per search`));
            console.log(chalk.gray(`User Agent: ${this.config.userAgent.substring(0, 50)}...`));
            
            return true;
        } catch (error) {
            console.error(chalk.red('❌ Failed to initialize Google API searcher'), error.message);
            throw error;
        }
    }
    
    /**
     * Perform a Google search using direct HTTP request
     */
    async search(query, maxResults = null) {
        try {
            if (this.blocked) {
                throw new Error('Google has blocked our requests. Please use proxy or wait before retrying.');
            }
            
            const resultsToGet = maxResults || this.config.maxResults;
            this.logger?.info(`Searching Google for: ${query}`);
            
            console.log(chalk.blue(`🔍 Searching: ${query}`));
            
            // Build search URL
            const searchUrl = this.buildSearchUrl(query, resultsToGet);
            
            // Perform search with retries
            let response = null;
            let retries = 0;
            
            while (retries <= this.config.maxRetries) {
                try {
                    response = await this.httpClient.get(searchUrl);
                    break; // Success, exit retry loop
                } catch (error) {
                    retries++;
                    
                    if (retries > this.config.maxRetries) {
                        throw error;
                    }
                    
                    console.log(chalk.yellow(`⚠️ Request failed, retrying (${retries}/${this.config.maxRetries})...`));
                    await sleep(this.config.delay * retries); // Exponential backoff
                }
            }
            
            // Check if we've been blocked
            if (this.isBlocked(response.data)) {
                this.blocked = true;
                throw new Error('Google has detected automated requests and blocked access');
            }
            
            // Parse results
            const results = this.parseSearchResults(response.data, query);
            
            console.log(chalk.green(`✅ Found ${results.length} results`));
            this.logger?.info(`Google search completed: ${results.length} results found`);
            
            // Increment search count and add delay
            this.searchCount++;
            
            if (this.config.delay > 0) {
                await sleep(this.config.delay);
            }
            
            return results;
            
        } catch (error) {
            this.logger?.error('Google search failed', { query, error: error.message });
            console.error(chalk.red(`❌ Search failed: ${error.message}`));
            throw error;
        }
    }
    
    /**
     * Build Google search URL with proper parameters
     */
    buildSearchUrl(query, maxResults) {
        const baseUrl = 'https://www.google.com/search';
        
        const params = new URLSearchParams({
            q: query,
            num: Math.min(maxResults, 100), // Google's max per page
            client: 'safari',
            rls: 'en',
            ie: 'UTF-8',
            oe: 'UTF-8',
            start: 0,
            as_qdr: 'all', // Any time
            filter: '0', // No filtering
            safe: 'off', // No safe search
            lr: 'lang_en' // English results
        });
        
        return `${baseUrl}?${params.toString()}`;
    }
    
    /**
     * Parse Google search results from HTML
     */
    parseSearchResults(html, _originalQuery) {
        try {
            const dom = new JSDOM(html);
            const document = dom.window.document;
            
            const results = [];
            const seenUrls = new Set();
            
            // Primary selector for search results
            const resultContainers = document.querySelectorAll('div.g, div[data-ved]');
            
            for (const container of resultContainers) {
                try {
                    // Look for the main link
                    const linkElement = container.querySelector('a[href^="/url?"], a[href^="http"], h3 a, [role="link"]');
                    
                    if (!linkElement) continue;
                    
                    let url = linkElement.href;
                    
                    // Extract real URL from Google redirect
                    if (url && url.includes('/url?')) {
                        const urlParams = new URLSearchParams(url.split('?')[1]);
                        url = urlParams.get('url') || urlParams.get('q');
                    }
                    
                    // Skip invalid or duplicate URLs
                    if (!url || !url.startsWith('http') || seenUrls.has(url)) {
                        continue;
                    }
                    
                    // Skip Google's own URLs
                    if (url.includes('google.com') || url.includes('youtube.com')) {
                        continue;
                    }
                    
                    // Get title
                    const titleElement = container.querySelector('h3, .LC20lb, .DKV0Md');
                    const title = titleElement ? titleElement.textContent.trim() : '';
                    
                    // Get description
                    const descElements = container.querySelectorAll('.VwiC3b, .s3v9rd, .st, span:not([class])');
                    let description = '';
                    
                    for (const descElement of descElements) {
                        const text = descElement.textContent.trim();
                        if (text.length > description.length && text.length > 20) {
                            description = text;
                        }
                    }
                    
                    // Only add if we have a URL and some content
                    if (url && (title || description)) {
                        seenUrls.add(url);
                        results.push({
                            url: url.trim(),
                            title: title || 'No title',
                            description: description || 'No description',
                            source: 'google-api'
                        });
                    }
                    
                } catch (e) {
                    // Skip this result if parsing fails
                    this.logger?.debug('Failed to parse search result', { error: e.message });
                    continue;
                }
            }
            
            // If primary method didn't work, try alternative selectors
            if (results.length === 0) {
                console.log(chalk.yellow('⚠️ Primary parsing failed, trying alternative method...'));
                return this.parseResultsAlternative(document);
            }
            
            this.logger?.info(`Parsed ${results.length} results from Google search`);
            return results;
            
        } catch (error) {
            this.logger?.error('Failed to parse Google search results', { error: error.message });
            console.error(chalk.red('❌ Failed to parse search results'));
            return [];
        }
    }
    
    /**
     * Alternative parsing method for when primary method fails
     */
    parseResultsAlternative(document) {
        const results = [];
        const seenUrls = new Set();
        
        // Try to find any links that look like search results
        const allLinks = document.querySelectorAll('a[href^="http"], a[href^="/url?"]');
        
        for (const link of allLinks) {
            try {
                let url = link.href;
                
                // Extract real URL from Google redirect
                if (url.includes('/url?')) {
                    const urlParams = new URLSearchParams(url.split('?')[1]);
                    url = urlParams.get('url') || urlParams.get('q');
                }
                
                // Skip invalid, duplicate, or Google URLs
                if (!url || !url.startsWith('http') || seenUrls.has(url) || 
                    url.includes('google.com') || url.includes('youtube.com')) {
                    continue;
                }
                
                const title = link.textContent.trim() || 'No title';
                
                // Simple heuristic to filter out navigation links
                if (title.length > 5 && !title.includes('Cache') && !title.includes('Similar')) {
                    seenUrls.add(url);
                    results.push({
                        url: url.trim(),
                        title: title,
                        description: 'No description available',
                        source: 'google-api-alternative'
                    });
                }
                
            } catch (e) {
                continue;
            }
        }
        
        return results.slice(0, this.config.maxResults);
    }
    
    /**
     * Check if Google has blocked our requests
     */
    isBlocked(html) {
        const blockIndicators = [
            'Our systems have detected unusual traffic',
            'Please complete this reCAPTCHA',
            'blocked your request',
            'unusual traffic from your computer network',
            'verify you are human',
            'captcha',
            'reCAPTCHA'
        ];
        
        const lowerHtml = html.toLowerCase();
        return blockIndicators.some(indicator => lowerHtml.includes(indicator.toLowerCase()));
    }
    
    /**
     * Perform multiple searches with different queries
     */
    async batchSearch(queries, maxResults = null) {
        const allResults = {};
        
        console.log(chalk.blue(`🚀 Starting batch search for ${queries.length} queries...`));
        
        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            
            try {
                console.log(chalk.cyan(`📊 Progress: ${i + 1}/${queries.length} - Searching: ${query.substring(0, 50)}...`));
                
                const results = await this.search(query, maxResults);
                allResults[query] = results;
                
                console.log(chalk.green(`✅ Query ${i + 1}/${queries.length} completed: ${results.length} results`));
                
            } catch (error) {
                console.error(chalk.red(`❌ Query ${i + 1}/${queries.length} failed: ${error.message}`));
                allResults[query] = [];
                
                // If we're blocked, stop the batch
                if (this.blocked) {
                    console.log(chalk.red('🚫 Google has blocked requests. Stopping batch search.'));
                    break;
                }
            }
        }
        
        return allResults;
    }
    
    /**
     * Get search statistics
     */
    getStats() {
        return {
            searchCount: this.searchCount,
            blocked: this.blocked,
            userAgent: this.config.userAgent,
            delay: this.config.delay
        };
    }
    
    /**
     * Reset the blocked status (use with caution)
     */
    resetBlockedStatus() {
        this.blocked = false;
        console.log(chalk.yellow('⚠️ Blocked status reset. Use with caution.'));
    }
} 