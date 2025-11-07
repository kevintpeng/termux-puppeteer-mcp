# Termux Puppeteer MCP Server

A Puppeteer MCP (Model Context Protocol) server that works on Android Termux by running Chromium inside an Alpine Linux container via `proot-distro`.

## Why This Exists

Standard Puppeteer MCP servers don't work on Android/Termux because:
- No ARM build of Chrome exists
- Puppeteer requires a Chromium-based browser

This solution uses Alpine Linux in a containerized environment to run Chromium, while the MCP server runs in Termux and bridges commands to Alpine.

## Quick Setup

**Automated installation** (recommended):

```bash
bash setup.sh
```

The script will automatically:
1. Install proot-distro
2. Install Alpine Linux
3. Install Chromium and Node.js in Alpine
4. Install Puppeteer in Alpine
5. Set up the MCP server in Termux
6. Create configuration files

**No device root required!**

Takes about 5-10 minutes depending on your connection.

## Manual Setup

If already set up or prefer manual installation:
- ✅ Alpine Linux installed via `proot-distro`
- ✅ Chromium installed in Alpine
- ✅ Node.js and npm in both Termux and Alpine
- ✅ Puppeteer installed in Alpine

## Available Tools

The server provides these Puppeteer tools via MCP:

1. **puppeteer_navigate** - Navigate to a URL and get page content/title
2. **puppeteer_screenshot** - Take screenshots (returns base64)
3. **puppeteer_pdf** - Generate PDFs from URLs (returns base64)
4. **puppeteer_evaluate** - Execute JavaScript in page context
5. **puppeteer_click** - Click elements on pages

## Usage with Claude Code

Add this to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "node",
      "args": ["/data/data/com.termux/files/home/termux-puppeteer-mcp/index.js"]
    }
  }
}
```

Or use the absolute path to node:

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "/data/data/com.termux/files/usr/bin/node",
      "args": ["/data/data/com.termux/files/home/termux-puppeteer-mcp/index.js"]
    }
  }
}
```

## Testing

You can test the server using the MCP inspector or by running:

```bash
node index.js
```

The server communicates via stdio using the MCP protocol.

## How It Works

1. MCP server runs in Termux (native Android environment)
2. When a tool is called, it generates Puppeteer JavaScript code
3. Code is executed inside Alpine Linux using `proot-distro login alpine`
4. Chromium runs in Alpine with appropriate flags (`--no-sandbox`, etc.)
5. Results are returned back through the MCP protocol

## Example Commands

From Claude Code:
- "Take a screenshot of example.com"
- "Get the title of google.com"
- "Generate a PDF of github.com"
- "Click the login button on example.com"

## Notes

- No device root required (proot works without root)
- Chromium runs in headless mode
- Screenshots are compressed JPEG (quality 60%, 800x600) to fit MCP token limits
- PDFs are returned as base64
- The proot warning about sanitizing bindings is normal and can be ignored

## Files

- `setup.sh` - Automated installation script
- `index.js` - MCP server implementation
- `package.json` - Node.js dependencies
- `.mcp.json` - MCP server configuration for Claude Code
- `README.md` - This file
- `SETUP.md` - Detailed setup guide

## Sharing

To share this setup online:
1. The `setup.sh` script contains all installation steps
2. Users can run it on any Termux installation
3. Works on ARM64 Android devices without root

## License

MIT - Feel free to use and modify
