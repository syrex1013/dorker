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
    resultsSelector: "li.b_algo",             // each result block :contentReference[oaicite:1]{index=1}
    linkSelector: "h2 > a",                  // link is inside h2 :contentReference[oaicite:2]{index=2}
    titleSelector: "h2",                     // title is the h2 element :contentReference[oaicite:3]{index=3}
    descriptionSelector: "p",                // snippet is in a <p> tag :contentReference[oaicite:4]{index=4}
  },
  duckduckgo: {
    name: "DuckDuckGo",
    baseUrl: "https://duckduckgo.com",
    searchUrl: "https://duckduckgo.com/?q=",
    waitTime: 2000,
    resultsSelector: "article[data-testid='result']",          // a single result unit
    linkSelector: "a[data-testid='result-title-a']",          // link wrapping the title
    titleSelector: "a[data-testid='result-title-a'] span",    // the span inside the link
    descriptionSelector: "div[data-testid='result-description']", // result snippet container
  },
};

export { SEARCH_ENGINES };
