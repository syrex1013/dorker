# Advanced Google Dorker with Enhanced Stealth

A sophisticated Google dorking tool with advanced anti-detection features, unique fingerprinting per session, and human-like behavior simulation.

## Features

- **🛡️ Advanced Stealth Mode**: Each browser session has a completely unique fingerprint
- **🤖 Human-like Behavior**: Simulates natural mouse movements, typing patterns, and browsing behavior
- **🔄 CAPTCHA Handling**: Automatic detection with manual solving support + free audio challenge solving
- **🎵 Audio CAPTCHA Solver**: Uses browser's Web Speech API and pattern recognition (completely free, no API keys needed)
- **🌐 Multi-Engine Support**: Google, Bing, and DuckDuckGo
- **📊 Session Management**: Automatic session cleanup and fingerprint rotation
- **🎯 Smart Detection Evasion**: Advanced techniques to avoid bot detection

## Installation

1.  Clone the repository:

    ```bash
    git clone <your-repo-url>
    cd dorker
    ```

2.  Install the dependencies:

    ```bash
    npm install
    ```

3.  Ready to use! Audio CAPTCHA solving is completely free and requires no setup.

## Usage

### Interactive Mode (Recommended)

```bash
node index.js
```

### Command Line Mode

```bash
node index.js -f dorks.txt -e google -m 10 -d 3000 --no-headless
```

### Options

- `-f, --file <path>`: Path to the dork file
- `-e, --engine <engine>`: Search engine (google, bing, duckduckgo)
- `-m, --max-results <number>`: Maximum results per dork
- `-d, --delay <milliseconds>`: Delay between requests
- `--no-headless`: Show the browser window
- `--interactive`: Force interactive mode

## Avoiding CAPTCHAs

The tool includes several measures to avoid triggering CAPTCHAs:

1. **Unique Fingerprints**: Each session uses a unique browser fingerprint
2. **Human-like Behavior**: Simulates natural mouse movements and typing
3. **Smart Delays**: Randomized delays between searches
4. **Session Warmup**: Option to browse normal sites before dorking
5. **Direct URL Mode**: Falls back to direct URL navigation after multiple CAPTCHAs

### Tips for Better Results

1. **Use Longer Delays**: Set delay to 5000ms or more between searches
2. **Limit Results**: Use fewer max results per dork (3-5)
3. **Use Headless Mode Sparingly**: Running with `--no-headless` can help with manual CAPTCHA solving
4. **Rotate IP Addresses**: Consider using a VPN or proxy service
5. **Warm Up Sessions**: Let the browser visit normal sites before starting

## Advanced Features

### Fingerprint Randomization

- Screen resolutions and device scale factors
- WebGL vendor/renderer information
- Languages and timezones
- Hardware specifications
- Platform-specific user agents

### Human Behavior Simulation

- Natural mouse movements with bezier curves
- F-pattern and Z-pattern reading simulation
- Realistic typing with occasional typos
- Momentum-based scrolling
- Random micro-movements and pauses

### CAPTCHA Handling

- **Automatic CAPTCHA detection**: Detects reCAPTCHA, hCaptcha, and Cloudflare challenges
- **Free audio solving**: Automatically attempts audio challenges using browser's Web Speech API
- **Manual solving interface**: User-friendly manual solving with 3-minute timeout
- **Automatic fallback**: Falls back to direct URL mode after multiple CAPTCHAs
- **2captcha integration**: Support for paid solving service (set CAPTCHA_TOKEN environment variable)

#### Audio CAPTCHA Solving (100% Free)

The tool can automatically solve audio CAPTCHAs using completely free methods:

1. **Web Speech API**: Uses browser's built-in speech recognition (Chrome/Edge)
2. **Pattern Recognition**: Simple pattern matching for common CAPTCHA sequences
3. **Fallback Methods**: Smart guessing based on common CAPTCHA patterns

**How it works:**

1. When a CAPTCHA appears, the tool will:
   - Click the audio challenge button
   - Use browser's Web Speech API to transcribe the audio
   - Enter the transcription automatically
   - Submit the solution
2. **No API keys needed** - completely free and offline
3. **No external services** - uses only browser capabilities

**Supported CAPTCHA Types:**

- Google reCAPTCHA v2 (audio challenges)
- hCaptcha (audio challenges)
- Most standard audio CAPTCHA implementations

**Browser Compatibility:**

- Chrome/Chromium: Full Web Speech API support
- Edge: Full Web Speech API support
- Firefox: Limited support, falls back to pattern recognition

## Troubleshooting

### Getting Too Many CAPTCHAs?

1. Increase delay between searches
2. Use a residential proxy or VPN
3. Run in non-headless mode for manual solving
4. Reduce the number of concurrent searches

### No Results Found?

1. Check if the dork syntax is correct
2. Verify you're not being blocked by checking the browser window
3. Try simpler dorks first (e.g., `site:wikipedia.org`)
4. Check the logs in the `logs/` directory

### Audio CAPTCHA Not Working?

1. **Browser Compatibility**: Use Chrome or Edge for best Web Speech API support
2. **Microphone Permissions**: Browser may ask for microphone permissions (allow them)
3. **Audio Quality**: Some audio CAPTCHAs may be too distorted for recognition
4. **Network Issues**: Ensure stable internet connection for audio playback
5. **Fallback**: The tool will fall back to manual solving if audio fails

**Tips for Better Audio CAPTCHA Success:**

- **Use Chrome/Chromium**: Best Web Speech API support
- **Enable microphone**: Browser needs microphone access for speech recognition
- **Quiet environment**: Background noise can interfere with recognition
- **Try multiple times**: Audio CAPTCHAs can be regenerated if first attempt fails

## License

MIT
