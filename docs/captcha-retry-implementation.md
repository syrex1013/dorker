# CAPTCHA Retry Implementation with Proxy Switching

## Overview

This document describes the implementation of automatic CAPTCHA retry functionality with proxy switching and browser restart in the MultiEngineDorker class.

## Key Changes

### 1. CAPTCHA Failure Handling

When CAPTCHA solving fails, the system now:
1. Generates a new proxy (if auto proxy is enabled)
2. Restarts the browser with the new proxy
3. Retries the same dork with the same engine

### 2. Engine Execution Order

The batch search now ensures:
1. All dorks are completed for one engine before moving to the next
2. All pages are scraped for each dork before moving to the next dork
3. If CAPTCHA fails at any point, the system retries with the same engine after proxy switch

## Implementation Details

### Modified Methods

#### `performSearch()`

The main search method now handles CAPTCHA failures by:
- Catching CAPTCHA handling errors
- Switching proxy if auto proxy is enabled
- Restarting the browser
- Inserting the current engine back into the queue to retry

```javascript
if (!captchaHandled) {
  if (this.config.autoProxy) {
    // Generate new proxy
    const proxySwitched = await this.switchProxy();
    if (proxySwitched) {
      // Restart browser with new proxy
      await this.restartBrowser();
      // Retry the same engine
      engines.splice(engines.indexOf(engine), 0, engine);
      continue;
    }
  }
}
```

#### `handlePaginationForEngine()`

Pagination now also handles CAPTCHA failures:
- Throws `CAPTCHA_FAILED_PAGINATION` error when CAPTCHA fails
- This triggers browser restart in the pagination loop

#### Pagination Loop

The pagination loop in `performSearch()` now:
- Catches `CAPTCHA_FAILED_PAGINATION` errors
- Triggers proxy switch and browser restart
- Breaks out of pagination to retry the entire search

## Flow Diagram

```
Start Search
    ↓
CAPTCHA Detected?
    ├─ No → Perform Search
    └─ Yes → Try to Solve CAPTCHA
              ↓
         CAPTCHA Solved?
              ├─ Yes → Perform Search
              └─ No & Auto Proxy → Generate New Proxy
                                      ↓
                                  Restart Browser
                                      ↓
                                  Retry Same Engine & Dork
```

## Benefits

1. **Resilience**: Automatically recovers from CAPTCHA blocks
2. **Completeness**: Ensures all dorks and pages are processed for each engine
3. **Efficiency**: Only retries when necessary, not the entire batch
4. **Order Preservation**: Maintains the intended engine execution order

## Configuration

To enable this feature, ensure:
- `autoProxy: true` in the configuration
- Valid ASOCKS API credentials are set

## Testing

Use the test file `test/captcha-retry-test.js` to verify the implementation:

```bash
node test/captcha-retry-test.js
```

This will test:
- CAPTCHA retry behavior
- Engine execution order
- Pagination handling
- Proxy switching and browser restart 