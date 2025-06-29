# DORKER - Advanced Google Dorking Tool

A powerful Google dorking tool built with Node.js and Puppeteer, featuring advanced anti-detection capabilities and a modern web dashboard.

## Features

- **Advanced Anti-Detection**: Stealth mode, human-like behavior simulation, and intelligent CAPTCHA handling
- **Live Web Dashboard**: Real-time monitoring and configuration through a modern web interface
- **Multi-Engine Support**: Support for multiple search engines (when enabled)
- **Automatic Proxy Switching**: Integration with ASOCKS for IP rotation
- **Comprehensive Logging**: Detailed logging with file output and web viewing
- **Flexible Configuration**: Both CLI and web-based configuration options

## Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd dorker
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create your dorks file:

   ```bash
   echo "site:example.com filetype:pdf" > dorks.txt
   ```

## Usage

### Server Mode (Recommended)

Run the application in server mode for web-based configuration:

```bash
# Start server on default port (3000)
npm run server

# Start server on custom port
node index.js --server --port 8080
```

Then open your browser to `http://localhost:3000` (or your custom port) to:

- Configure all dorking parameters through the web interface
- Start/stop dorking sessions
- Monitor progress in real-time
- View and export results

### Interactive Mode (Traditional CLI)

For traditional command-line interaction:

```bash
# Standard interactive mode
npm start

# Or directly
node index.js
```

### Command Line Options

- `--server` or `-s`: Run in server mode with web configuration
- `--port <number>` or `-p <number>`: Specify port for server mode (default: 3000)
- `--interactive` or `-i`: Run in interactive CLI mode (default when no server flag)

## Configuration Options

### Web Configuration (Server Mode)

When running in server mode, configure the following through the web interface:

- **Dork File Path**: Path to your dorks file (default: `dorks.txt`)
- **Output File Path**: Where to save results (default: `results.json`)
- **Results per Search**: Number of results to fetch per dork (1-100)
- **Search Delay**: Delay between searches in seconds (5-60)
- **Maximum Pause**: Maximum random pause length (30-60)
- **Browser Settings**: Headless mode, custom user agent
- **Security Settings**: Manual CAPTCHA mode, human-like behavior
- **Proxy Settings**: Automatic proxy switching via ASOCKS
- **Advanced Settings**: Multi-engine dorking

### CLI Configuration (Interactive Mode)

In interactive mode, you'll be prompted for all configuration options through a modern CLI interface.

## Dashboard Features

The web dashboard provides:

- **Real-time Statistics**: Progress, success rate, results count
- **Live Monitoring**: Current dork being processed, proxy status
- **Security Metrics**: CAPTCHA encounters and solve rates
- **Performance Charts**: Visual representation of search performance
- **Results Viewer**: Browse and export found URLs
- **System Logs**: Detailed logging with filtering
- **Data Export**: Export results, logs, and statistics in JSON format

## File Structure

```
dorker/
├── src/
│   ├── browser/          # Browser management
│   ├── captcha/          # CAPTCHA detection and handling
│   ├── config/           # Configuration management
│   ├── constants/        # Search engine constants
│   ├── dorker/           # Main dorking logic
│   ├── proxy/            # Proxy management
│   ├── ui/               # CLI interface
│   ├── utils/            # Utility functions
│   └── web/              # Web dashboard
├── logs/                 # Application logs
├── temp/                 # Temporary files
├── dorks.txt            # Your dorks file
└── results.json         # Output results
```

## Security Features

- **Stealth Mode**: Advanced browser fingerprint randomization
- **Human-like Behavior**: Random mouse movements, typing patterns
- **CAPTCHA Handling**: Automatic audio CAPTCHA solving with manual fallback
- **Proxy Rotation**: Automatic IP switching to avoid detection
- **Rate Limiting**: Intelligent delays between requests
- **User Agent Rotation**: Dynamic user agent switching

## Advanced Usage

### Custom Proxy Configuration

For ASOCKS integration, ensure you have valid ASOCKS credentials configured in your environment.

### Batch Processing

Create multiple dork files and run them sequentially:

```bash
# Process multiple dork files
node index.js --server  # Configure each file through web interface
```

### Result Processing

Results are saved in JSON format with detailed metadata:

```json
{
  "dork": "site:example.com filetype:pdf",
  "results": [
    {
      "title": "Example PDF Document",
      "url": "https://example.com/document.pdf",
      "snippet": "..."
    }
  ],
  "timestamp": "2024-01-01T12:00:00Z",
  "searchTime": 1250
}
```

## Troubleshooting

### Common Issues

1. **CAPTCHA Blocks**: Enable manual CAPTCHA mode for difficult challenges
2. **Rate Limiting**: Increase delays between searches
3. **Proxy Issues**: Verify ASOCKS credentials and connectivity
4. **Browser Crashes**: Try running in headless mode

### Debug Mode

Enable verbose logging for troubleshooting:

```bash
# Check logs directory
ls -la logs/

# View latest log
tail -f logs/dorker-*.log
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

This project is licensed under the MIT License. See LICENSE file for details.

## Disclaimer

This tool is for educational and legitimate security testing purposes only. Always comply with robots.txt, terms of service, and applicable laws when using this tool.
