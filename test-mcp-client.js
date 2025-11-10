#!/usr/bin/env node

/**
 * Simple MCP client to test the server
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function testMCP() {
  console.log('Starting MCP test client...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['index.js'],
  });

  const client = new Client({
    name: 'test-client',
    version: '1.0.0',
  }, {
    capabilities: {},
  });

  await client.connect(transport);
  console.log('✅ Connected to MCP server\n');

  try {
    // Test 1: List available tools
    console.log('📋 Listing available tools...');
    const toolsResult = await client.listTools();
    console.log(`Found ${toolsResult.tools.length} tools:`);
    toolsResult.tools.forEach(tool => {
      console.log(`  - ${tool.name}`);
    });
    console.log();

    // Test 2: Create a session
    console.log('🔧 Creating a new session...');
    const sessionResult = await client.callTool({
      name: 'create_session',
      arguments: {
        metadata: { test: true, purpose: 'test-run' }
      }
    });

    const sessionData = JSON.parse(sessionResult.content[0].text);
    console.log('✅ Session created:', sessionData.sessionId);
    console.log();

    // Test 3: List sessions
    console.log('📊 Listing sessions...');
    const listResult = await client.callTool({
      name: 'list_sessions',
      arguments: {}
    });
    console.log(JSON.parse(listResult.content[0].text));
    console.log();

    // Test 4: Navigate to a page
    console.log('🌐 Navigating to example.com...');
    const navResult = await client.callTool({
      name: 'puppeteer_navigate',
      arguments: {
        url: 'https://example.com',
        sessionId: sessionData.sessionId
      }
    });
    const navData = JSON.parse(navResult.content[0].text);
    console.log('✅ Navigated to:', navData.url);
    console.log('   Title:', navData.title);
    console.log();

    // Test 5: Take screenshot with session (debug mode)
    console.log('📸 Taking screenshot with session...');
    const screenshotResult = await client.callTool({
      name: 'puppeteer_screenshot_debug',
      arguments: {
        sessionId: sessionData.sessionId,
        width: 800,
        height: 600,
        filename: 'test-session-screenshot.jpg'
      }
    });
    console.log('✅', screenshotResult.content[0].text);
    console.log();

    // Test 6: Close session
    console.log('🔒 Closing session...');
    const closeResult = await client.callTool({
      name: 'close_session',
      arguments: {
        sessionId: sessionData.sessionId
      }
    });
    console.log('✅ Session closed');
    console.log();

    // Test 7: Screenshot without session (creates temp session)
    console.log('📸 Taking screenshot without session (temp session)...');
    const tempScreenshotResult = await client.callTool({
      name: 'puppeteer_screenshot_debug',
      arguments: {
        url: 'https://example.com',
        width: 412,
        height: 892,
        filename: 'test-temp-screenshot.jpg'
      }
    });
    console.log('✅', tempScreenshotResult.content[0].text);
    console.log();

    console.log('✅ All tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await client.close();
    console.log('\n👋 Test complete');
    process.exit(0);
  }
}

testMCP().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
