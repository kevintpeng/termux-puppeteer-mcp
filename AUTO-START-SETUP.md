# Auto-Start Setup for Termux Puppeteer MCP

## Problem
Previously, the Termux Puppeteer MCP Server (v2) required manual intervention to start the browser server in Alpine before it could function. Users/agents had to manually run:
```bash
proot-distro login alpine -- node /root/browser-server.js &
```

This created a poor user experience and required extra setup steps.

## Solution
The MCP server now automatically detects if the browser server is running and starts it if needed during initialization.

## Changes Made

### 1. Modified `index-v2.js`

Added three new functions to handle auto-start:

#### `isBrowserServerRunning()`
- Checks if the browser server is responding at `http://127.0.0.1:3000/health`
- Returns `true` if server returns HTTP 200, `false` otherwise
- Uses a 3-second timeout to avoid hanging

#### `startBrowserServer()`
- Uses the existing `daemon-manager.sh` script to start the browser server
- Waits up to 5 seconds for the server to become ready
- Handles errors gracefully and verifies server is running even if script reports errors

#### `ensureBrowserServer()`
- Called during MCP server initialization
- Checks if browser server is running
- Starts it automatically if not running
- Logs status messages for debugging

### 2. Integration into Main Function

The `main()` function now calls `ensureBrowserServer()` before connecting the MCP transport:

```javascript
async function main() {
  // Ensure browser server is running before starting MCP server
  ensureBrowserServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Termux Puppeteer MCP Server v2 (Session-based) running');
}
```

## How It Works

1. When Claude Code starts and loads the MCP server, the `main()` function runs
2. `ensureBrowserServer()` is called first
3. It checks if the browser server is already running
4. If running: logs a message and continues
5. If not running: automatically starts it using `daemon-manager.sh`
6. The MCP server only connects after ensuring the browser server is ready

## Benefits

- **Zero Manual Steps**: No need to manually start the browser server
- **Resilient**: Automatically recovers if the browser server crashes
- **User-Friendly**: Works out of the box without extra setup
- **Idempotent**: Safe to call multiple times (won't start duplicate servers)

## Testing

To test the auto-start functionality:

1. Stop the browser server:
   ```bash
   ./daemon-manager.sh stop
   ```

2. Restart Claude Code (which will restart the MCP server)

3. The MCP server should automatically start the browser server

4. Verify with:
   ```bash
   ./daemon-manager.sh status
   ```

## Dependencies

- Requires `daemon-manager.sh` in the same directory as `index-v2.js`
- Requires `browser-server.js` in the same directory
- Requires Alpine proot-distro environment with Node.js, Chromium, and required npm packages

## Logging

The auto-start process logs messages to stderr (visible in MCP server logs):

- `[MCP] Browser server already running` - Server was already running
- `[MCP] Browser server not running, attempting to start...` - Starting the server
- `[MCP] Starting browser server in Alpine...` - Starting via daemon-manager
- `[MCP] Browser server started successfully` - Server is now running
- `[MCP] Error starting browser server: <error>` - Something went wrong

## Future Improvements

Possible enhancements:

1. Add retry logic with exponential backoff
2. Implement health check monitoring to restart crashed servers
3. Add configuration options for auto-start behavior
4. Implement graceful shutdown when MCP server exits

## Files Modified

- `index-v2.js` - Added auto-start logic
- `.mcp.json` - Already configured to use `index-v2.js`

## Verification

The setup has been tested and verified to:
- Detect when browser server is not running
- Use daemon-manager.sh to start the server
- Wait for the server to become ready
- Handle errors gracefully

Current status: **Auto-start is enabled and functional**
