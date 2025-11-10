#!/usr/bin/env node

/**
 * Simplified test - Single CUJ: create → navigate → evaluate → screenshot
 */

import { execSync } from 'child_process';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const BROWSER_SERVER_URL = 'http://127.0.0.1:3000';

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function apiCall(method, path, body = null) {
  let curlCmd;
  if (method === 'GET' || method === 'DELETE') {
    curlCmd = `curl -s -X ${method} ${BROWSER_SERVER_URL}${path}`;
  } else {
    const jsonData = JSON.stringify(body);
    const escapedJson = jsonData.replace(/"/g, '\\"');
    curlCmd = `curl -s -X ${method} -H 'Content-Type: application/json' -d "${escapedJson}" ${BROWSER_SERVER_URL}${path}`;
  }

  try {
    const result = execSync(
      `proot-distro login alpine -- ${curlCmd}`,
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'ignore']
      }
    );
    const lines = result.split('\n');
    const jsonLine = lines.find(line => line.trim().startsWith('{'));
    if (!jsonLine) {
      throw new Error(`No JSON response found in: ${result}`);
    }
    return JSON.parse(jsonLine);
  } catch (error) {
    if (error.stdout) {
      const lines = error.stdout.split('\n');
      const jsonLine = lines.find(line => line.trim().startsWith('{'));
      if (jsonLine) {
        return JSON.parse(jsonLine);
      }
    }
    throw new Error(`API call failed: ${error.message}`);
  }
}

async function testCompleteCUJ() {
  log('\n═══════════════════════════════════════════════════════', 'cyan');
  log('Complete CUJ Test: create → navigate → evaluate → screenshot', 'bright');
  log('═══════════════════════════════════════════════════════', 'cyan');

  try {
    // Step 1: Health check
    log('\n→ Step 1: Health check...', 'yellow');
    const health = apiCall('GET', '/health');
    log(`✅ Server healthy - ${health.sessions}/${health.maxSessions} sessions`, 'green');

    // Step 2: Create session
    log('\n→ Step 2: Creating session...', 'yellow');
    const createResp = apiCall('POST', '/session/create', {
      metadata: { test: 'simple-cuj' }
    });
    const sessionId = createResp.sessionId;
    log(`✅ Session created: ${sessionId}`, 'green');

    // Step 3: Navigate
    log('\n→ Step 3: Navigate to example.com...', 'yellow');
    const navResp = apiCall('POST', `/session/${sessionId}/navigate`, {
      url: 'https://example.com'
    });
    log(`✅ Navigated to: ${navResp.title}`, 'green');
    log(`   URL: ${navResp.url}`, 'blue');

    // Step 4: Evaluate JavaScript
    log('\n→ Step 4: Evaluate JavaScript...', 'yellow');
    const evalResp = apiCall('POST', `/session/${sessionId}/evaluate`, {
      script: `
        return {
          title: document.title,
          h1Count: document.querySelectorAll('h1').length,
          pCount: document.querySelectorAll('p').length,
          url: window.location.href
        }
      `
    });
    log(`✅ JavaScript executed`, 'green');
    log(`   Result: ${JSON.stringify(evalResp.result, null, 2)}`, 'blue');

    // Step 5: Take screenshot
    log('\n→ Step 5: Taking screenshot...', 'yellow');
    const screenshotResp = apiCall('POST', `/session/${sessionId}/screenshot`, {
      width: 800,
      height: 600
    });
    const screenshotSize = screenshotResp.screenshot.length;
    log(`✅ Screenshot captured (${screenshotSize} bytes base64)`, 'green');

    // Step 6: Close session
    log('\n→ Step 6: Closing session...', 'yellow');
    apiCall('DELETE', `/session/${sessionId}`);
    log('✅ Session closed', 'green');

    log('\n═══════════════════════════════════════════════════════', 'cyan');
    log('🎉 Complete CUJ test passed!', 'green');
    log('═══════════════════════════════════════════════════════', 'cyan');

    return true;
  } catch (error) {
    log(`\n❌ Test failed: ${error.message}`, 'red');
    console.error(error.stack);
    return false;
  }
}

testCompleteCUJ().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error.stack);
  process.exit(1);
});
