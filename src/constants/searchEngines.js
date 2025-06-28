const SEARCH_ENGINES = {
  google: {
    name: "Google",
    baseUrl: "https://www.google.com",
    searchUrl: "https://www.google.com/search?q=",
    waitTime: 3000,
    resultsSelector: "div.g",
    linkSelector: "a",
    titleSelector: "h3",
    descriptionSelector: "span",
  },
  bing: {
    name: "Bing",
    baseUrl: "https://www.bing.com",
    searchUrl: "https://www.bing.com/search?q=",
    waitTime: 2500,
    resultsSelector: "li.b_algo",
    linkSelector: "h2 a",
    titleSelector: "h2",
    descriptionSelector: "p",
  },
  duckduckgo: {
    name: "DuckDuckGo",
    baseUrl: "https://duckduckgo.com",
    searchUrl: "https://duckduckgo.com/?q=",
    waitTime: 2000,
    resultsSelector: "article[data-testid='result']",
    linkSelector: "a[data-testid='result-title-a']",
    titleSelector: "span",
    descriptionSelector: "span",
  },
};

export { SEARCH_ENGINES };
