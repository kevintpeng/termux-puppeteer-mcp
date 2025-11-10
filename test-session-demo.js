#!/usr/bin/env node

/**
 * Demo test for session-based architecture
 * Demonstrates multi-step workflows and multi-agent isolation
 */

import { execSync } from 'child_process';

// Color codes for terminal output
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
  if (method === 'GET') {
    curlCmd = `curl -s -X GET ${BROWSER_SERVER_URL}${path}`;
  } else {
    const jsonData = JSON.stringify(body);
    const escapedJson = jsonData.replace(/"/g, '\\"');
    curlCmd = `curl -s -X ${method} -H 'Content-Type: application/json' -d "${escapedJson}" ${BROWSER_SERVER_URL}${path}`;
  }

  try {
    // Use stdio: 'pipe' to capture output even if proot exits with non-zero code
    const result = execSync(
      `proot-distro login alpine -- ${curlCmd}`,
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'ignore'] // Ignore stderr to suppress proot warnings
      }
    );
    // Parse the first line that looks like JSON
    const lines = result.split('\n');
    const jsonLine = lines.find(line => line.trim().startsWith('{'));
    if (!jsonLine) {
      throw new Error(`No JSON response found in: ${result}`);
    }
    return JSON.parse(jsonLine);
  } catch (error) {
    // If execSync throws, check if we still got output
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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testHealthCheck() {
  log('\n═══════════════════════════════════════════════════════', 'cyan');
  log('Test 1: Health Check', 'bright');
  log('═══════════════════════════════════════════════════════', 'cyan');

  try {
    const response = apiCall('GET', '/health');
    log('✅ Server is healthy', 'green');
    log(`   Sessions: ${response.sessions}/${response.maxSessions}`, 'blue');
    log(`   Uptime: ${Math.round(response.uptime)}s`, 'blue');
    return true;
  } catch (error) {
    log(`❌ Health check failed: ${error.message}`, 'red');
    return false;
  }
}

async function testSessionLifecycle() {
  log('\n═══════════════════════════════════════════════════════', 'cyan');
  log('Test 2: Session Lifecycle', 'bright');
  log('═══════════════════════════════════════════════════════', 'cyan');

  try {
    // Create session
    log('\n→ Creating session...', 'yellow');
    const createResp = apiCall('POST', '/session/create', {
      metadata: { test: 'lifecycle' }
    });
    log(`✅ Session created: ${createResp.sessionId}`, 'green');

    const sessionId = createResp.sessionId;

    // Get session info
    log('\n→ Getting session info...', 'yellow');
    const infoResp = apiCall('GET', `/session/${sessionId}/info`);
    log(`✅ Session info retrieved`, 'green');
    log(`   Pages: ${infoResp.session.pagesCount}`, 'blue');
    log(`   Idle time: ${infoResp.session.idleTime}ms`, 'blue');

    // Close session
    log('\n→ Closing session...', 'yellow');
    const closeResp = apiCall('DELETE', `/session/${sessionId}`);
    log(`✅ Session closed`, 'green');

    return true;
  } catch (error) {
    log(`❌ Session lifecycle test failed: ${error.message}`, 'red');
    return false;
  }
}

async function testNavigation() {
  log('\n═══════════════════════════════════════════════════════', 'cyan');
  log('Test 3: Navigation & Content Retrieval', 'bright');
  log('═══════════════════════════════════════════════════════', 'cyan');

  try {
    // Create session
    log('\n→ Creating session...', 'yellow');
    const createResp = apiCall('POST', '/session/create', {
      metadata: { test: 'navigation' }
    });
    const sessionId = createResp.sessionId;
    log(`✅ Session: ${sessionId}`, 'green');

    // Navigate to example.com
    log('\n→ Navigating to example.com...', 'yellow');
    const navResp = apiCall('POST', `/session/${sessionId}/navigate`, {
      url: 'https://example.com',
      waitUntil: 'networkidle2'
    });
    log(`✅ Navigation complete`, 'green');
    log(`   Title: ${navResp.title}`, 'blue');
    log(`   URL: ${navResp.url}`, 'blue');

    // Get page content
    log('\n→ Getting page content...', 'yellow');
    const contentResp = apiCall('GET', `/session/${sessionId}/content`);
    log(`✅ Content retrieved`, 'green');
    log(`   Content length: ${contentResp.contentLength} chars`, 'blue');

    // Close session
    apiCall('DELETE', `/session/${sessionId}`);
    log('\n✅ Session closed', 'green');

    return true;
  } catch (error) {
    log(`❌ Navigation test failed: ${error.message}`, 'red');
    return false;
  }
}

async function testMultiStepWorkflow() {
  log('\n═══════════════════════════════════════════════════════', 'cyan');
  log('Test 4: Multi-Step Workflow (State Persistence)', 'bright');
  log('═══════════════════════════════════════════════════════', 'cyan');

  try {
    // Create session
    log('\n→ Creating session...', 'yellow');
    const createResp = apiCall('POST', '/session/create', {
      metadata: { test: 'multi-step' }
    });
    const sessionId = createResp.sessionId;
    log(`✅ Session: ${sessionId}`, 'green');

    // Step 1: Navigate
    log('\n→ Step 1: Navigate to example.com...', 'yellow');
    const navResp = apiCall('POST', `/session/${sessionId}/navigate`, {
      url: 'https://example.com'
    });
    log(`✅ Navigated to: ${navResp.title}`, 'green');

    // Step 2: Evaluate JavaScript
    log('\n→ Step 2: Evaluate JavaScript...', 'yellow');
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

    // Step 3: Take screenshot
    log('\n→ Step 3: Taking screenshot...', 'yellow');
    const screenshotResp = apiCall('POST', `/session/${sessionId}/screenshot`, {
      width: 800,
      height: 600
    });
    log(`✅ Screenshot captured (${screenshotResp.screenshot.length} bytes base64)`, 'green');

    // Close session
    apiCall('DELETE', `/session/${sessionId}`);
    log('\n✅ Session closed', 'green');

    return true;
  } catch (error) {
    log(`❌ Multi-step workflow test failed: ${error.message}`, 'red');
    return false;
  }
}

async function testMultiAgentIsolation() {
  log('\n═══════════════════════════════════════════════════════', 'cyan');
  log('Test 5: Multi-Agent Isolation', 'bright');
  log('═══════════════════════════════════════════════════════', 'cyan');

  try {
    // Agent 1: Create session and navigate to example.com
    log('\n→ Agent 1: Creating session...', 'yellow');
    const agent1Session = apiCall('POST', '/session/create', {
      metadata: { agent: 'agent-1' }
    }).sessionId;
    log(`✅ Agent 1 Session: ${agent1Session}`, 'green');

    log('→ Agent 1: Navigating to example.com...', 'yellow');
    const agent1Nav = apiCall('POST', `/session/${agent1Session}/navigate`, {
      url: 'https://example.com'
    });
    log(`✅ Agent 1 navigated to: ${agent1Nav.title}`, 'green');

    // Agent 2: Create session and navigate to example.org
    log('\n→ Agent 2: Creating session...', 'yellow');
    const agent2Session = apiCall('POST', '/session/create', {
      metadata: { agent: 'agent-2' }
    }).sessionId;
    log(`✅ Agent 2 Session: ${agent2Session}`, 'green');

    log('→ Agent 2: Navigating to example.org...', 'yellow');
    const agent2Nav = apiCall('POST', `/session/${agent2Session}/navigate`, {
      url: 'https://example.org'
    });
    log(`✅ Agent 2 navigated to: ${agent2Nav.title}`, 'green');

    // Verify isolation: Check Agent 1 is still on example.com
    log('\n→ Verifying Agent 1 state preserved...', 'yellow');
    const agent1Content = apiCall('GET', `/session/${agent1Session}/content`);
    if (agent1Content.url.includes('example.com')) {
      log(`✅ Agent 1 still on example.com (isolated!)`, 'green');
    } else {
      log(`❌ Agent 1 state corrupted: ${agent1Content.url}`, 'red');
    }

    // Verify isolation: Check Agent 2 is on example.org
    log('→ Verifying Agent 2 state preserved...', 'yellow');
    const agent2Content = apiCall('GET', `/session/${agent2Session}/content`);
    if (agent2Content.url.includes('example.org')) {
      log(`✅ Agent 2 on example.org (isolated!)`, 'green');
    } else {
      log(`❌ Agent 2 state corrupted: ${agent2Content.url}`, 'red');
    }

    // List all sessions
    log('\n→ Listing all sessions...', 'yellow');
    const sessionsList = apiCall('GET', '/sessions');
    log(`✅ Active sessions: ${sessionsList.count}`, 'green');
    sessionsList.sessions.forEach(s => {
      log(`   - ${s.id}: ${s.currentUrl} (${s.metadata.agent})`, 'blue');
    });

    // Clean up
    apiCall('DELETE', `/session/${agent1Session}`);
    apiCall('DELETE', `/session/${agent2Session}`);
    log('\n✅ Both sessions closed', 'green');

    return true;
  } catch (error) {
    log(`❌ Multi-agent isolation test failed: ${error.message}`, 'red');
    return false;
  }
}

async function main() {
  log('\n╔════════════════════════════════════════════════════════════╗', 'bright');
  log('║  Session-Based Architecture Test Suite                    ║', 'bright');
  log('╚════════════════════════════════════════════════════════════╝', 'bright');

  const results = {
    healthCheck: false,
    sessionLifecycle: false,
    navigation: false,
    multiStep: false,
    multiAgent: false,
  };

  // Run tests
  results.healthCheck = await testHealthCheck();
  await sleep(1000);

  results.sessionLifecycle = await testSessionLifecycle();
  await sleep(1000);

  results.navigation = await testNavigation();
  await sleep(1000);

  results.multiStep = await testMultiStepWorkflow();
  await sleep(1000);

  results.multiAgent = await testMultiAgentIsolation();

  // Summary
  log('\n═══════════════════════════════════════════════════════', 'cyan');
  log('Test Results Summary', 'bright');
  log('═══════════════════════════════════════════════════════', 'cyan');

  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;

  Object.entries(results).forEach(([name, result]) => {
    const icon = result ? '✅' : '❌';
    const color = result ? 'green' : 'red';
    log(`${icon} ${name}`, color);
  });

  log(`\nPassed: ${passed}/${total}`, passed === total ? 'green' : 'yellow');

  if (passed === total) {
    log('\n🎉 All tests passed!', 'green');
    process.exit(0);
  } else {
    log('\n⚠️  Some tests failed', 'yellow');
    process.exit(1);
  }
}

main().catch(error => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error.stack);
  process.exit(1);
});
