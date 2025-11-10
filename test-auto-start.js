#!/usr/bin/env node

/**
 * Test script to verify auto-start functionality
 * This simulates what happens when the MCP server starts
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

function escapeShellArg(arg) {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

function isBrowserServerRunning() {
  try {
    const result = execSync(
      `proot-distro login alpine -- sh -c ${escapeShellArg('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/health')}`,
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    return result === '200';
  } catch (error) {
    return false;
  }
}

function startBrowserServer() {
  try {
    console.log('[TEST] Starting browser server in Alpine...');

    const browserServerPath = join(process.cwd(), 'browser-server.js');
    const browserServerCode = readFileSync(browserServerPath, 'utf8');

    execSync(
      `proot-distro login alpine -- sh -c ${escapeShellArg(`cat > /root/browser-server.js << 'EOFSCRIPT'\n${browserServerCode}\nEOFSCRIPT`)}`,
      { timeout: 5000 }
    );

    execSync(
      `proot-distro login alpine -- sh -c ${escapeShellArg('nohup node /root/browser-server.js > /root/browser-server.log 2>&1 & echo $! > /root/browser-server.pid')}`,
      { timeout: 5000 }
    );

    for (let i = 0; i < 20; i++) {
      if (isBrowserServerRunning()) {
        console.log('[TEST] Browser server started successfully');
        return true;
      }
      execSync('sleep 0.5');
    }

    console.log('[TEST] Warning: Browser server may not have started properly');
    return false;
  } catch (error) {
    console.error('[TEST] Error starting browser server:', error.message);
    return false;
  }
}

// Test the auto-start logic
console.log('[TEST] Checking browser server status...');
if (isBrowserServerRunning()) {
  console.log('[TEST] ✅ Browser server is already running');
} else {
  console.log('[TEST] ❌ Browser server is NOT running');
  console.log('[TEST] Attempting to start it...');
  const success = startBrowserServer();

  if (success) {
    console.log('[TEST] ✅ Auto-start successful!');
  } else {
    console.log('[TEST] ❌ Auto-start failed');
    process.exit(1);
  }
}

// Verify it's running
console.log('[TEST] Final check...');
if (isBrowserServerRunning()) {
  console.log('[TEST] ✅ Browser server is now running');
  console.log('[TEST] All tests passed!');
} else {
  console.log('[TEST] ❌ Browser server is still not running');
  process.exit(1);
}
