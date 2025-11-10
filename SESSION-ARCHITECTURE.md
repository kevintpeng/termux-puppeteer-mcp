# Session-Based Architecture - Multi-Agent Support

## Overview

This implementation solves the **state persistence problem** by introducing a **long-running browser server** in Alpine that maintains session state between MCP calls.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Claude Code (Multiple Agents/Conversations)         │
│                                                      │
│  Agent 1: Testing e-commerce checkout flow          │
│  Agent 2: Scraping product data                     │
│  Agent 3: Monitoring website changes                │
└──────────────────┬──────────────────────────────────┘
                   │ MCP Protocol (stdio)
                   │
┌──────────────────▼──────────────────────────────────┐
│ MCP Server v2 (Termux) - index-v2.js                │
│                                                      │
│ - Receives tool calls from Claude Code              │
│ - Manages session lifecycle                         │
│ - Forwards requests to browser server via HTTP      │
│ - Handles temporary sessions (backwards compat)     │
└──────────────────┬──────────────────────────────────┘
                   │ HTTP REST API
                   │ (localhost:3000)
                   │
┌──────────────────▼──────────────────────────────────┐
│ Browser Server (Alpine) - browser-server.js         │
│                                                      │
│ Persistent Daemon running in Alpine proot           │
│                                                      │
│ ┌────────────────────────────────────────────────┐  │
│ │ Session Manager                                │  │
│ │                                                │  │
│ │ ┌─────────────┐  ┌─────────────┐             │  │
│ │ │ Session A   │  │ Session B   │   ...       │  │
│ │ │ (Agent 1)   │  │ (Agent 2)   │             │  │
│ │ │             │  │             │             │  │
│ │ │ Browser     │  │ Browser     │             │  │
│ │ │ └─ Page 1   │  │ └─ Page 1   │             │  │
│ │ │ └─ Page 2   │  │ └─ Page 2   │             │  │
│ │ │             │  │             │             │  │
│ │ │ Cookies     │  │ Cookies     │             │  │
│ │ │ LocalStorage│  │ LocalStorage│             │  │
│ │ │ Session Data│  │ Session Data│             │  │
│ │ └─────────────┘  └─────────────┘             │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ Features:                                            │
│ - Max 5 concurrent sessions (configurable)          │
│ - Auto-cleanup: 5min idle timeout                   │
│ - Session isolation (separate browser contexts)     │
│ - RESTful API for all operations                    │
└──────────────────────────────────────────────────────┘
```

## Key Features

### 1. Session Persistence ✅

**Problem Solved:**
- Each MCP call in v1 launched a new browser and lost all state
- Couldn't perform multi-step workflows like: login → navigate → click → screenshot

**Solution:**
- Browser server maintains persistent browser instances
- Sessions identified by UUID (e.g., `ses_a1b2c3d4-e5f6-7890-abcd-ef1234567890`)
- State preserved: cookies, localStorage, DOM state, navigation history

### 2. Multi-Agent Isolation ✅

**Scenario:** Multiple Claude Code agents/conversations running simultaneously

**How it works:**

Each agent creates its own session:

```javascript
// Agent 1: Testing checkout flow
sessionA = create_session({ metadata: { agent: "checkout-tester" }})
→ ses_abc123

// Agent 2: Scraping products
sessionB = create_session({ metadata: { agent: "product-scraper" }})
→ ses_def456

// Agent 3: Monitoring changes
sessionC = create_session({ metadata: { agent: "change-monitor" }})
→ ses_ghi789
```

**Isolation guarantees:**
- ✅ Separate browser instances (process isolation)
- ✅ Separate cookie stores (no cross-contamination)
- ✅ Independent navigation state
- ✅ Isolated JavaScript execution contexts

### 3. Resource Management

**Limits:**
- **Max sessions:** 5 concurrent (configurable in `browser-server.js`)
- **Session timeout:** 5 minutes idle time (auto-cleanup)
- **Cleanup interval:** Checks every 60 seconds

**What happens when limit reached:**
1. New session request triggers cleanup of expired sessions
2. If still at limit, request fails with clear error message
3. Agent must wait or close existing sessions

### 4. Backwards Compatibility

**Stateless mode** (like v1):
```javascript
// No sessionId provided → creates temporary session
puppeteer_screenshot({ url: "https://example.com" })

// Behind the scenes:
// 1. Creates session
// 2. Navigates to URL
// 3. Takes screenshot
// 4. Destroys session
// ✅ No session management needed
```

**Stateful mode** (new):
```javascript
// Explicit session management
sessionId = create_session()

puppeteer_navigate({ url: "...", sessionId })
puppeteer_click({ selector: "...", sessionId })
puppeteer_screenshot({ sessionId })  // Captures result of click!

close_session({ sessionId })
```

## Usage Examples

### Example 1: Your Use Case - Navigate, Click, Debug Screenshot

```javascript
// Step 1: Create session
const session = create_session({
  metadata: { purpose: "testing-login-flow" }
})
// → { sessionId: "ses_abc123..." }

// Step 2: Navigate to page
puppeteer_navigate({
  url: "https://example.com",
  sessionId: session.sessionId
})
// → { success: true, title: "Example Domain" }

// Step 3: Click login button
puppeteer_click({
  selector: ".login-btn",
  sessionId: session.sessionId,
  waitForNavigation: true
})
// → { success: true, newUrl: "https://example.com/dashboard" }

// Step 4: Debug screenshot (captures state AFTER click!)
puppeteer_screenshot_debug({
  sessionId: session.sessionId,
  width: 412,   // Pixel 7 Pro
  height: 892
})
// → Screenshot saved and opened in Android viewer
// Shows the dashboard page (result of the click!)

// Step 5: Clean up
close_session({ sessionId: session.sessionId })
```

### Example 2: Multi-Agent Scenario

**Agent 1** (testing checkout flow):
```javascript
const ses1 = create_session({ metadata: { agent: "checkout-test" }})

puppeteer_navigate({ url: "https://shop.example.com", sessionId: ses1.sessionId })
puppeteer_click({ selector: ".add-to-cart", sessionId: ses1.sessionId })
puppeteer_click({ selector: ".checkout-btn", sessionId: ses1.sessionId })
puppeteer_evaluate({
  script: "return document.querySelector('.cart-total').textContent",
  sessionId: ses1.sessionId
})
// → { result: "$99.99" }

// Keep session alive for further testing...
```

**Agent 2** (scraping products - SIMULTANEOUS):
```javascript
const ses2 = create_session({ metadata: { agent: "product-scraper" }})

puppeteer_navigate({ url: "https://shop.example.com/catalog", sessionId: ses2.sessionId })
puppeteer_evaluate({
  script: `
    return Array.from(document.querySelectorAll('.product')).map(p => ({
      name: p.querySelector('.name').textContent,
      price: p.querySelector('.price').textContent
    }))
  `,
  sessionId: ses2.sessionId
})
// → { result: [{ name: "Widget", price: "$10" }, ...] }

close_session({ sessionId: ses2.sessionId })
```

**Both agents operate independently** with no interference!

### Example 3: Form Filling Multi-Step Workflow

```javascript
const session = create_session()

// Step 1: Navigate to form
puppeteer_navigate({
  url: "https://example.com/signup",
  sessionId: session.sessionId
})

// Step 2: Fill form fields using evaluate
puppeteer_evaluate({
  script: `
    document.querySelector('#name').value = 'John Doe';
    document.querySelector('#email').value = 'john@example.com';
    document.querySelector('#password').value = 'SecurePass123';
    return true;
  `,
  sessionId: session.sessionId
})

// Step 3: Click submit
puppeteer_click({
  selector: "#submit-btn",
  sessionId: session.sessionId,
  waitForNavigation: true
})

// Step 4: Verify success page
puppeteer_evaluate({
  script: "return document.querySelector('.success-message').textContent",
  sessionId: session.sessionId
})
// → { result: "Account created successfully!" }

// Step 5: Screenshot for documentation
puppeteer_screenshot_debug({ sessionId: session.sessionId })

close_session({ sessionId: session.sessionId })
```

## API Reference

### Session Management Tools

#### `create_session`
Creates a new browser session.

**Parameters:**
- `metadata` (optional): Object with custom metadata

**Returns:**
```json
{
  "sessionId": "ses_a1b2c3d4...",
  "message": "Session created..."
}
```

#### `close_session`
Closes a session and releases resources.

**Parameters:**
- `sessionId` (required): Session ID to close

#### `list_sessions`
Lists all active sessions.

**Returns:**
```json
{
  "sessions": [
    {
      "id": "ses_abc123",
      "pagesCount": 2,
      "currentUrl": "https://example.com",
      "lastAccessed": 1699564800000,
      "idleTime": 1234,
      "metadata": { "agent": "test" }
    }
  ],
  "count": 1
}
```

### Browser Action Tools

All browser action tools accept optional `sessionId`:
- **With sessionId:** Operates on existing session state
- **Without sessionId:** Creates temporary session (backwards compatible)

#### `puppeteer_navigate`
#### `puppeteer_click`
#### `puppeteer_screenshot`
#### `puppeteer_screenshot_debug`
#### `puppeteer_evaluate`
#### `get_page_content`

See `index-v2.js` for detailed schemas.

## Setup & Deployment

### 1. Install Browser Server Dependencies

```bash
# In Alpine (first time only)
proot-distro login alpine -- apk add curl

# Sharp is already installed for screenshots
```

### 2. Start Browser Server Daemon

```bash
# Make daemon manager executable
chmod +x daemon-manager.sh

# Start the browser server in Alpine
./daemon-manager.sh start

# Check status
./daemon-manager.sh status

# View logs
./daemon-manager.sh logs
```

### 3. Configure Claude Code MCP

Update your `.mcp.json`:

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "node",
      "args": ["/data/data/com.termux/files/home/termux-puppeteer-mcp/index-v2.js"]
    }
  }
}
```

### 4. Restart Claude Code

The new session-based tools will be available.

## Daemon Management

```bash
# Start daemon
./daemon-manager.sh start

# Stop daemon
./daemon-manager.sh stop

# Restart daemon
./daemon-manager.sh restart

# Check status
./daemon-manager.sh status

# View logs (last 50 lines)
./daemon-manager.sh logs

# Tail logs live
./daemon-manager.sh logs-live

# Test HTTP connection
./daemon-manager.sh test
```

## Edge Cases Handled

### 1. Session Leaks
- Auto-cleanup every 60 seconds
- 5-minute idle timeout
- Graceful shutdown closes all sessions

### 2. Max Sessions Reached
- Attempts cleanup first
- Returns clear error if still at limit
- Agent can retry or close unused sessions

### 3. Browser Crashes
- Session marked as dead
- Next call fails with clear error
- Agent should close and recreate session

### 4. Network Issues
- HTTP request timeouts handled
- Clear error messages returned to Claude Code

### 5. Multiple Agents Same Session
- **NOT SUPPORTED** by design
- Each agent should create its own session
- Concurrent access to same session is undefined behavior

## Performance Considerations

### Session Creation Time
- **First call:** ~2-3 seconds (browser launch)
- **Subsequent calls:** <100ms (HTTP overhead)

### Memory Usage
- Each browser instance: ~100-150MB
- Max 5 sessions: ~750MB peak usage
- Acceptable on modern Android devices

### Network Latency
- Localhost HTTP: <10ms overhead
- Negligible compared to browser operations

## Migration from v1

### Option 1: Gradual Migration
Run both servers, update tools one at a time.

### Option 2: Full Switch
```bash
# Backup v1
mv index.js index-v1-backup.js

# Activate v2
mv index-v2.js index.js

# Update .mcp.json (already points to index.js)
```

### Option 3: Test Mode
Keep both, test v2 without affecting production:
```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "node",
      "args": ["index.js"]
    },
    "puppeteer-v2": {
      "command": "node",
      "args": ["index-v2.js"]
    }
  }
}
```

## Troubleshooting

### Browser server not starting
```bash
./daemon-manager.sh logs
# Check for port conflicts, missing dependencies
```

### Sessions not being created
```bash
# Test HTTP connection
./daemon-manager.sh test

# Check Alpine network
proot-distro login alpine -- curl http://127.0.0.1:3000/health
```

### Sessions expiring too quickly
Edit `browser-server.js`:
```javascript
const CONFIG = {
  SESSION_TIMEOUT_MS: 10 * 60 * 1000, // 10 minutes instead of 5
}
```

Then restart:
```bash
./daemon-manager.sh restart
```

## Future Enhancements

1. **Session persistence to disk** (survive daemon restarts)
2. **WebSocket support** for real-time events
3. **Screenshot streaming** for debugging
4. **Session sharing** (with locking for multi-agent collaboration)
5. **Metrics & monitoring** dashboard
