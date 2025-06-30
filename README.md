# 🔍 DORKER - Advanced Google Dorking Automation Tool

<div align="center">

![DORKER Banner](https://img.shields.io/badge/DORKER-Advanced_Dorking_Tool-blue?style=for-the-badge&logo=google&logoColor=white)

[![Node.js](https://img.shields.io/badge/Node.js-18+-green?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Puppeteer](https://img.shields.io/badge/Puppeteer-Latest-orange?style=flat-square&logo=puppeteer)](https://pptr.dev/)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](CONTRIBUTING.md)

**🚀 A powerful, automated Google dorking tool with AI-powered CAPTCHA solving and real-time monitoring**

[Features](#-features) • [Installation](#-installation) • [Usage](#-usage) • [Dashboard](#-web-dashboard) • [API](#-api-reference)

</div>

---

## 📋 Table of Contents

- [✨ Features](#-features)
- [🚀 Installation](#-installation)
- [⚙️ Configuration](#️-configuration)
- [🎯 Usage](#-usage)
- [🌐 Web Dashboard](#-web-dashboard)
- [🔧 CLI Reference](#-cli-reference)
- [🤖 AI-Powered CAPTCHA Solving](#-ai-powered-captcha-solving)
- [🛡️ Security & Anti-Detection](#️-security--anti-detection)
- [📊 API Reference](#-api-reference)
- [🐛 Troubleshooting](#-troubleshooting)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## ✨ Features

### 🎯 **Core Functionality**

- 🔍 **Multi-Engine Dorking** - Support for Google and other search engines
- 📝 **Bulk Dork Processing** - Process hundreds of dorks automatically
- 🎭 **Human-Like Behavior** - Advanced anti-detection with realistic browsing patterns
- 🌐 **Proxy Integration** - Automatic proxy rotation via ASOCKS API
- 📊 **Real-Time Results** - Live result extraction and monitoring

### 🤖 **AI-Powered Intelligence**

- 🎧 **Audio CAPTCHA Solving** - Automatic transcription using ElevenLabs API
- 🧠 **Smart Challenge Detection** - AI-powered CAPTCHA and challenge recognition
- 🔄 **Adaptive Behavior** - Dynamic response to different security measures
- 📈 **Performance Learning** - Optimizes strategies based on success rates

### 🌐 **Advanced Web Dashboard**

- 📊 **Real-Time Monitoring** - Live session statistics and progress tracking
- 🎮 **Interactive Controls** - Start, stop, and configure sessions from web interface
- 📈 **Performance Analytics** - Detailed charts and success rate analysis
- 🔔 **Smart Notifications** - Real-time alerts and completion notifications
- 📱 **Responsive Design** - Beautiful UI that works on all devices

### 🛡️ **Security & Stealth**

- 🎭 **Browser Fingerprinting** - Randomized browser fingerprints
- 🌍 **Geolocation Spoofing** - Dynamic location and timezone changes
- 🕰️ **Smart Delays** - Intelligent timing between requests
- 🔒 **Session Management** - Secure session handling and cleanup

### 📊 **Data Management**

- 💾 **Multiple Export Formats** - JSON, CSV, and plain text exports
- 🗃️ **Duplicate Detection** - Automatic URL deduplication
- 📂 **Organized Results** - Structured result organization by dork
- 🔄 **Resume Capability** - Continue interrupted sessions

---

## 🚀 Installation

### 📋 Prerequisites

- **Node.js** 18+ ([Download](https://nodejs.org/))
- **npm** or **yarn** package manager
- **Git** for cloning the repository

### 🔧 Quick Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/dorker.git
cd dorker

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit configuration (see Configuration section)
nano .env
```

### 🐳 Docker Installation (Optional)

```bash
# Build Docker image
docker build -t dorker .

# Run with Docker
docker run -d --name dorker-app -p 3000:3000 dorker
```

---

## ⚙️ Configuration

### 🔑 Environment Variables

Create a `.env` file in the project root:

```env
# 🤖 AI Services
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
OPENAI_API_KEY=your_openai_api_key_here

# 🌐 Proxy Services
ASOCKS_API_KEY=your_asocks_api_key_here

# 🔧 Optional Services
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

### 📁 Dork Files

Create your dork list in `dorks.txt`:

```text
site:example.com filetype:pdf
inurl:admin intitle:login
site:*.edu filetype:xls "password"
intext:"sql syntax near" site:*.com
"index of" inurl:ftp
```

### ⚙️ Configuration Options

| Option              | Description                 | Default |
| ------------------- | --------------------------- | ------- |
| `resultCount`       | Results per search          | `30`    |
| `maxPages`          | Max pages per dork          | `1`     |
| `minDelay`          | Min delay between searches  | `10s`   |
| `maxDelay`          | Max delay between searches  | `45s`   |
| `headless`          | Run browser in background   | `false` |
| `humanLike`         | Enable human behavior       | `true`  |
| `autoProxy`         | Auto proxy switching        | `false` |
| `manualCaptchaMode` | Manual CAPTCHA solving      | `false` |
| `dorkFiltering`     | Filter URLs by dork pattern | `true`  |

---

## 🎯 Usage

### 🖥️ **Interactive Mode** (Recommended)

```bash
# Start interactive CLI mode
npm start

# Follow the guided setup process
```

### 🌐 **Server Mode** (Web Dashboard)

```bash
# Start web server mode
npm run server

# Open dashboard at http://localhost:3000
```

### ⚡ **Direct CLI Mode**

```bash
# Run with specific configuration
node index.js --headless --delay=20 --results=50

# Custom port for server mode
npm run server:port 8080
```

---

## 🌐 Web Dashboard

### 🎮 **Interactive Features**

- **🚀 One-Click Start** - Configure and launch sessions instantly
- **📊 Live Statistics** - Real-time progress and success rates
- **🎯 Current Processing** - See exactly what dork is being processed
- **📈 Performance Charts** - Visual analytics and trends
- **🔔 Smart Notifications** - Desktop and in-app alerts
- **💾 Export Tools** - Download results in multiple formats

### 📱 **Mobile Responsive**

The dashboard works perfectly on:

- 🖥️ Desktop computers
- 📱 Mobile phones
- 📟 Tablets
- 💻 Laptops

### 🎨 **Dark/Light Theme**

Switch between beautiful dark and light themes with a single click!

---

## 🔧 CLI Reference

### 🏃 **Running Modes**

```bash
# Interactive mode with guided setup
npm start

# Server mode for web dashboard
npm run server

# Development mode with auto-restart
npm run dev

# Lint code before running
npm run lint
```

### 🎛️ **Command Line Options**

```bash
node index.js [options]

Options:
  --server          Start in server mode
  --port <number>   Server port (default: 3000)
  --headless        Run browser in headless mode
  --delay <seconds> Delay between searches
  --results <count> Results per search
  --proxy           Enable proxy rotation
  --verbose         Enable verbose logging
```

### 📝 **Examples**

```bash
# Basic dorking session
node index.js

# Headless mode with custom settings
node index.js --headless --delay=15 --results=25

# Server mode on custom port
node index.js --server --port=8080

# Maximum stealth mode
node index.js --headless --proxy --delay=30
```

---

## 🤖 AI-Powered CAPTCHA Solving

### 🎧 **Audio CAPTCHA Transcription**

DORKER uses advanced AI to automatically solve audio CAPTCHAs:

1. **🔍 Detection** - Automatically detects CAPTCHA challenges
2. **🎵 Audio Extraction** - Downloads CAPTCHA audio files
3. **🤖 AI Transcription** - Uses ElevenLabs API for speech-to-text
4. **✅ Auto-Submission** - Submits the transcribed solution
5. **🔄 Fallback Handling** - Switches to proxy rotation if needed

### 🎯 **Supported CAPTCHA Types**

- ✅ **Google reCAPTCHA v2** (Audio)
- ✅ **Google reCAPTCHA v3** (Behavioral)
- ✅ **Simple Math Challenges**
- ✅ **Text-based CAPTCHAs**
- 🔄 **hCaptcha** (Coming Soon)

### 📊 **Success Rates**

- 🎧 **Audio CAPTCHAs**: ~85% success rate
- 🧮 **Math Challenges**: ~95% success rate
- 🤖 **Behavioral**: ~90% success rate

---

## 🛡️ Security & Anti-Detection

### 🎭 **Browser Fingerprinting**

- **🖥️ Random Viewport Sizes** - Varies browser window dimensions
- **🌍 Geolocation Spoofing** - Randomizes location data
- **🕰️ Timezone Randomization** - Dynamic timezone changes
- **📱 User Agent Rotation** - Realistic browser identification
- **🎨 Canvas Fingerprinting** - Unique canvas signatures

### 🌐 **Network Security**

- **🔄 Proxy Rotation** - Automatic IP address changes
- **🕰️ Smart Delays** - Human-like timing patterns
- **📊 Request Throttling** - Prevents rate limiting
- **🛡️ Header Randomization** - Varies HTTP headers

### 🎮 **Behavioral Simulation**

- **🖱️ Natural Mouse Movement** - Realistic cursor paths
- **⌨️ Human Typing Patterns** - Variable typing speeds
- **📜 Scroll Simulation** - Natural page scrolling
- **⏸️ Random Pauses** - Mimics human reading time

---

## 📊 API Reference

### 🌐 **REST API Endpoints**

```bash
# Get current session statistics
GET /api/stats

# Get all results
GET /api/results

# Get system logs
GET /api/logs

# Get performance data
GET /api/performance

# Export session data
GET /api/export

# Health check
GET /api/health
```

### 🔌 **WebSocket Events**

```javascript
// Real-time statistics updates
socket.on("stats", (data) => {
  console.log("Live stats:", data);
});

// New results available
socket.on("results", (results) => {
  console.log("New results:", results);
});

// System logs
socket.on("logs", (log) => {
  console.log("System log:", log);
});

// Session completion
socket.on("sessionComplete", (summary) => {
  console.log("Session finished:", summary);
});
```

### 📝 **Example API Usage**

```javascript
// Get current session stats
const response = await fetch("/api/stats");
const stats = await response.json();

console.log(`Processed: ${stats.processedDorks}/${stats.totalDorks}`);
console.log(`Success Rate: ${stats.successRate}%`);
console.log(`Total Results: ${stats.totalResults}`);
```

---

## 🐛 Troubleshooting

### ❗ **Common Issues**

#### 🔒 **CAPTCHA Not Solving**

```bash
# Check ElevenLabs API key
echo $ELEVENLABS_API_KEY

# Verify API credits
curl -H "Authorization: Bearer $ELEVENLABS_API_KEY" \
     https://api.elevenlabs.io/v1/user
```

#### 🌐 **Proxy Connection Issues**

```bash
# Test ASOCKS connection
curl -H "Authorization: Bearer $ASOCKS_API_KEY" \
     https://asocks.com/api/getProxy
```

#### 🖥️ **Browser Launch Failures**

```bash
# Install missing dependencies (Linux)
sudo apt-get install -y gconf-service libasound2 libatk1.0-0 \
    libcairo-gobject2 libdrm2 libgtk-3-0 libx11-xcb1 libxss1

# For macOS
brew install --cask google-chrome
```

### 📋 **Debug Mode**

```bash
# Enable verbose logging
DEBUG=dorker:* npm start

# Check log files
tail -f logs/debug.log
```

### 🩺 **Health Checks**

```bash
# Test all services
curl http://localhost:3000/api/health

# Verify configuration
node -e "console.log(require('./src/config/index.js'))"
```

---

## 🤝 Contributing

We welcome contributions! Here's how you can help:

### 🚀 **Getting Started**

1. **🍴 Fork the repository**
2. **🌿 Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **💾 Commit your changes** (`git commit -m 'Add amazing feature'`)
4. **📤 Push to branch** (`git push origin feature/amazing-feature`)
5. **🔄 Open a Pull Request**

### 📝 **Contribution Guidelines**

- ✅ Follow the existing code style
- 📝 Add tests for new features
- 📚 Update documentation
- 🧪 Ensure all tests pass
- 🔍 Use meaningful commit messages

### 🐛 **Reporting Bugs**

Please use the [Issue Tracker](https://github.com/yourusername/dorker/issues) with:

- 📋 **Bug Description** - What happened?
- 🔄 **Reproduction Steps** - How to reproduce?
- 💻 **Environment Info** - OS, Node.js version, etc.
- 📊 **Expected vs Actual** - What should happen vs what happens?

### 💡 **Feature Requests**

We love new ideas! Please describe:

- 🎯 **Use Case** - What problem does it solve?
- 💼 **Business Value** - Why is it important?
- 🛠️ **Implementation Ideas** - How might it work?

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

### 📋 **License Summary**

```
MIT License - Free for commercial and personal use
✅ Commercial use
✅ Modification
✅ Distribution
✅ Private use
❌ Liability
❌ Warranty
```

---

## 🙏 Acknowledgments

### 🛠️ **Built With**

- **[Puppeteer](https://pptr.dev/)** - Browser automation
- **[ElevenLabs](https://elevenlabs.io/)** - AI speech recognition
- **[Express.js](https://expressjs.com/)** - Web framework
- **[Socket.IO](https://socket.io/)** - Real-time communication
- **[Chart.js](https://www.chartjs.org/)** - Data visualization

### 💖 **Special Thanks**

- 🌟 **Contributors** - Everyone who helped build this project
- 🧪 **Beta Testers** - Early users who provided feedback
- 🏢 **Open Source Community** - For the amazing tools and libraries

---

<div align="center">

### 🚀 **Ready to Start Dorking?**

[![Get Started](https://img.shields.io/badge/Get_Started-Now-green?style=for-the-badge&logo=rocket)](https://github.com/yourusername/dorker#installation)
[![Documentation](https://img.shields.io/badge/Read_Docs-blue?style=for-the-badge&logo=book)](https://github.com/yourusername/dorker/wiki)
[![Join Discord](https://img.shields.io/badge/Join_Community-Discord-purple?style=for-the-badge&logo=discord)](https://discord.gg/yourinvite)

**⭐ Don't forget to star the repository if you found it useful!**

Made with ❤️ by the DORKER Team

</div>

---

<div align="center">
<sub>🔍 Happy Dorking! • 🛡️ Use Responsibly • 🤝 Contribute Freely</sub>
</div>
