const SEARCH_ENGINES = {
  google: {
    name: "Google",
    baseUrl: "https://www.google.com",
    searchUrl: "https://www.google.com/search?q=",
    waitTime: 3000,
    resultsSelector: '#search .g',
    linkSelector: "a[href]:not([href=''])",
    titleSelector: "h3",
    descriptionSelector: "div.VwiC3b, div.IsZvec",
  },
  bing: {
    name: "Bing",
    baseUrl: "https://www.bing.com",
    searchUrl: "https://www.bing.com/search?q=",
    waitTime: 2500,
    resultsSelector: '#b_results > .b_algo',
    linkSelector: "h2 a",
    titleSelector: "h2",
    descriptionSelector: "p",
  },
  duckduckgo: {
    name: "DuckDuckGo",
    baseUrl: "https://duckduckgo.com",
    searchUrl: "https://duckduckgo.com/?q=",
    waitTime: 2000,
    resultsSelector: '[data-testid="result"], .result',
    linkSelector: "a[data-testid='result-title-a'], .result__a",
    titleSelector: "[data-testid='result-title-a'], .result__title a",
    descriptionSelector: "[data-testid='result-snippet'], .result__snippet",
  },
  
  "google-api": {
    name: "Google API",
    type: "api",
    description: "Direct HTTP requests to Google (no browser automation)",
    baseUrl: "https://www.google.com",
    waitTime: 2000,
    maxResults: 100,
    fast: true,
    noMovements: true
  },
};

export { SEARCH_ENGINES };
