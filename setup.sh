#!/data/data/com.termux/files/usr/bin/bash
#
# Termux Puppeteer MCP Setup Script
# ==================================
# This script sets up a working Puppeteer MCP server on Android Termux
# using Alpine Linux + Chromium in a proot container
#
# No device root required!
#
# Author: Created with Claude Code
# License: MIT

set -e  # Exit on error

echo "=========================================="
echo "Termux Puppeteer MCP Setup"
echo "=========================================="
echo ""
echo "This will install:"
echo "  - proot-distro (containerization)"
echo "  - Alpine Linux (in container)"
echo "  - Chromium browser (in Alpine)"
echo "  - Node.js & npm (both environments)"
echo "  - Puppeteer (in Alpine)"
echo "  - MCP Server (in Termux)"
echo ""
read -p "Press Enter to continue or Ctrl+C to cancel..."
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Check if we're in Termux
if [ ! -d "/data/data/com.termux" ]; then
    error "This script must be run in Termux on Android"
fi

# Step 1: Install proot-distro
info "Step 1/8: Installing proot-distro..."
if ! command -v proot-distro &> /dev/null; then
    pkg install proot-distro -y || error "Failed to install proot-distro"
    info "proot-distro installed successfully"
else
    info "proot-distro already installed"
fi
echo ""

# Step 2: Install Alpine Linux
info "Step 2/8: Installing Alpine Linux distribution..."
if ! proot-distro list | grep -q "alpine.*installed"; then
    proot-distro install alpine || error "Failed to install Alpine Linux"
    info "Alpine Linux installed successfully"
else
    info "Alpine Linux already installed"
fi
echo ""

# Step 3: Update Alpine package list
info "Step 3/8: Updating Alpine package repository..."
proot-distro login alpine -- apk update || error "Failed to update Alpine packages"
info "Package list updated"
echo ""

# Step 4: Install Chromium, Node.js, and npm in Alpine
info "Step 4/8: Installing Chromium and Node.js in Alpine (this may take 5-10 minutes)..."
proot-distro login alpine -- apk add --no-cache chromium nodejs npm || error "Failed to install packages in Alpine"
info "Chromium, Node.js, and npm installed in Alpine"
echo ""

# Step 5: Install Puppeteer in Alpine
info "Step 5/8: Installing Puppeteer in Alpine (this may take a few minutes)..."
proot-distro login alpine -- sh -c "cd /root && npm install puppeteer" || error "Failed to install Puppeteer"
info "Puppeteer installed in Alpine"
echo ""

# Step 6: Verify Puppeteer works with a test
info "Step 6/8: Testing Puppeteer installation..."
proot-distro login alpine -- sh -c "cat > /root/test-puppeteer.js << 'EOF'
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true
  });
  const page = await browser.newPage();
  await page.goto('https://example.com', { timeout: 30000 });
  const title = await page.title();
  console.log('Success! Page title:', title);
  await browser.close();
})();
EOF
node /root/test-puppeteer.js && rm /root/test-puppeteer.js" || error "Puppeteer test failed"
info "Puppeteer is working correctly!"
echo ""

# Step 7: Create project directory and install MCP dependencies
info "Step 7/8: Setting up MCP server in Termux..."
PROJECT_DIR="$HOME/termux-puppeteer-mcp"
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

# Create package.json if it doesn't exist
if [ ! -f "package.json" ]; then
    cat > package.json << 'EOF'
{
  "name": "termux-puppeteer-mcp",
  "version": "1.0.0",
  "description": "Puppeteer MCP server for Termux using Alpine Linux",
  "main": "index.js",
  "type": "module",
  "bin": {
    "termux-puppeteer-mcp": "./index.js"
  },
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.4"
  }
}
EOF
fi

# Install dependencies
npm install || error "Failed to install npm dependencies"
info "MCP dependencies installed"
echo ""

# Step 8: Create MCP configuration
info "Step 8/8: Creating MCP configuration..."
cat > .mcp.json << EOF
{
  "mcpServers": {
    "puppeteer": {
      "command": "/data/data/com.termux/files/usr/bin/node",
      "args": ["$PROJECT_DIR/index.js"]
    }
  }
}
EOF

chmod +x index.js 2>/dev/null || true

info "MCP configuration created"
echo ""

# Final message
echo "=========================================="
echo -e "${GREEN}Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "Your Puppeteer MCP server is ready!"
echo ""
echo "Location: $PROJECT_DIR"
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code in this directory:"
echo "     cd $PROJECT_DIR"
echo "     claude"
echo ""
echo "  2. When Claude Code starts, approve the 'puppeteer' MCP server"
echo ""
echo "  3. Try it out:"
echo "     - 'Take a screenshot of example.com'"
echo "     - 'Get the title of github.com'"
echo "     - 'Generate a PDF of this page'"
echo ""
echo "Available tools:"
echo "  - puppeteer_navigate"
echo "  - puppeteer_screenshot"
echo "  - puppeteer_pdf"
echo "  - puppeteer_evaluate"
echo "  - puppeteer_click"
echo ""
echo "For more info, see README.md"
echo ""
