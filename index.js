#!/usr/bin/env node

/**
 * Termux Puppeteer MCP Server v2
 * Session-based architecture with multi-agent support
 * Communicates with persistent browser server in Alpine
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const server = new Server(
  {
    name: 'termux-puppeteer-mcp',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const BROWSER_SERVER_URL = 'http://127.0.0.1:3000';

/**
 * Make HTTP request to browser server in Alpine
 */
function browserServerRequest(method, path, body = null) {
  let curlCmd;

  if (method === 'GET') {
    curlCmd = `curl -s -X GET "${BROWSER_SERVER_URL}${path}"`;
  } else if (body === null || body === undefined) {
    // Don't include -d flag for DELETE or other methods without a body
    curlCmd = `curl -s -X ${method} "${BROWSER_SERVER_URL}${path}"`;
  } else {
    curlCmd = `curl -s -X ${method} -H "Content-Type: application/json" -d ${escapeShellArg(JSON.stringify(body))} "${BROWSER_SERVER_URL}${path}"`;
  }

  try {
    const result = execSync(
      `proot-distro login alpine -- sh -c ${escapeShellArg(curlCmd)} 2>/dev/null`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );

    return JSON.parse(result);
  } catch (error) {
    throw new Error(`Browser server request failed: ${error.message}`);
  }
}

function escapeShellArg(arg) {
  // Escape for shell by wrapping in single quotes and escaping any single quotes
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * Helper to convert localhost URLs to file:// URLs
 */
function maybeConvertToFileUrl(url) {
  const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1):(\d+)(\/.*)?$/;
  const match = url.match(localhostPattern);

  if (match) {
    const pathWithQuery = match[3] || '/';
    const [path, queryString] = pathWithQuery.split('?');

    try {
      const cwd = execSync('pwd', { encoding: 'utf8' }).trim();

      if (path === '/' || path === '/index.html') {
        const filePath = join(cwd, 'index.html');
        return queryString ? `file://${filePath}?${queryString}` : `file://${filePath}`;
      } else if (!path.includes('..')) {
        const filePath = join(cwd, path.substring(1));
        return queryString ? `file://${filePath}?${queryString}` : `file://${filePath}`;
      }
    } catch (e) {
      return url;
    }
  }

  return url;
}

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Session management
      {
        name: 'create_session',
        description: 'Create a new browser session for multi-step workflows. Returns a sessionId that persists state between calls. Sessions auto-expire after 5 minutes of inactivity.',
        inputSchema: {
          type: 'object',
          properties: {
            metadata: {
              type: 'object',
              description: 'Optional metadata to attach to the session (e.g., agentId, purpose)',
            },
          },
        },
      },
      {
        name: 'close_session',
        description: 'Close a browser session and free up resources. Sessions auto-close after timeout, but explicit closing is recommended.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'The session ID to close',
            },
          },
          required: ['sessionId'],
        },
      },
      {
        name: 'list_sessions',
        description: 'List all active browser sessions with their status',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },

      // Browser actions (session-aware)
      {
        name: 'puppeteer_navigate',
        description: 'Navigate to a URL and get the page content/title. If sessionId provided, uses existing session. Otherwise creates a temporary session.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to navigate to',
            },
            sessionId: {
              type: 'string',
              description: 'Optional session ID to use. If not provided, creates a temporary session.',
            },
            waitUntil: {
              type: 'string',
              description: 'When to consider navigation finished: load, domcontentloaded, networkidle0, or networkidle2',
              default: 'networkidle2',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'puppeteer_click',
        description: 'Click an element on the current page. Requires sessionId to maintain state after navigation.',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector for the element to click',
            },
            sessionId: {
              type: 'string',
              description: 'Session ID (required for stateful operation)',
            },
            waitForNavigation: {
              type: 'boolean',
              description: 'Wait for navigation after click',
              default: false,
            },
          },
          required: ['selector', 'sessionId'],
        },
      },
      {
        name: 'puppeteer_screenshot',
        description: 'Take a screenshot of the current page state and return as base64 JPEG. If sessionId provided, screenshots the current state. Otherwise navigates to URL first.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL to screenshot (only used if sessionId not provided)',
            },
            sessionId: {
              type: 'string',
              description: 'Session ID to screenshot current state',
            },
            width: {
              type: 'number',
              description: 'Viewport width in pixels',
              default: 800,
            },
            height: {
              type: 'number',
              description: 'Viewport height in pixels',
              default: 600,
            },
            delay: {
              type: 'number',
              description: 'Additional delay in milliseconds after page load',
              default: 0,
            },
            waitForSelector: {
              type: 'string',
              description: 'CSS selector to wait for before taking screenshot',
            },
          },
        },
      },
      {
        name: 'puppeteer_screenshot_debug',
        description: 'Take a screenshot and save it to a file, then open with termux-open for debugging. Works with sessionId to capture current state.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL to screenshot (only used if sessionId not provided)',
            },
            sessionId: {
              type: 'string',
              description: 'Session ID to screenshot current state',
            },
            width: {
              type: 'number',
              description: 'Viewport width in pixels',
              default: 800,
            },
            height: {
              type: 'number',
              description: 'Viewport height in pixels',
              default: 600,
            },
            filename: {
              type: 'string',
              description: 'Output filename (defaults to screenshot-{timestamp}.jpg)',
            },
            delay: {
              type: 'number',
              description: 'Additional delay in milliseconds after page load',
              default: 0,
            },
          },
        },
      },
      {
        name: 'puppeteer_evaluate',
        description: 'Execute JavaScript in the page context and return the result. Requires sessionId.',
        inputSchema: {
          type: 'object',
          properties: {
            script: {
              type: 'string',
              description: 'JavaScript code to execute (can use return statement)',
            },
            sessionId: {
              type: 'string',
              description: 'Session ID (required)',
            },
          },
          required: ['script', 'sessionId'],
        },
      },
      {
        name: 'get_page_content',
        description: 'Get the HTML content of the current page. Requires sessionId.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID (required)',
            },
          },
          required: ['sessionId'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Convert localhost URLs
    if (args.url) {
      args.url = maybeConvertToFileUrl(args.url);
    }

    switch (name) {
      // Session management
      case 'create_session': {
        // Ensure browser server is running before creating session
        if (!ensureBrowserServer()) {
          throw new Error('Failed to start browser server. Please start it manually: proot-distro login alpine -- sh -c "cd /root && node browser-server.js"');
        }

        const response = browserServerRequest('POST', '/session/create', {
          metadata: args.metadata || {},
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: response.success,
              sessionId: response.sessionId,
              message: `Session created: ${response.sessionId}. Use this ID in subsequent calls to maintain state.`,
            }, null, 2)
          }],
        };
      }

      case 'close_session': {
        const response = browserServerRequest('DELETE', `/session/${args.sessionId}`);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: response.success,
              message: `Session ${args.sessionId} closed successfully`,
            }, null, 2)
          }],
        };
      }

      case 'list_sessions': {
        const response = browserServerRequest('GET', '/sessions');

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(response, null, 2)
          }],
        };
      }

      // Browser actions
      case 'puppeteer_navigate': {
        const sessionId = args.sessionId;
        const tempSession = !sessionId;

        // Create temp session if needed
        let activeSessionId = sessionId;
        if (tempSession) {
          const createResp = browserServerRequest('POST', '/session/create', {
            metadata: { temporary: true },
          });
          activeSessionId = createResp.sessionId;
        }

        // Navigate
        const response = browserServerRequest('POST', `/session/${activeSessionId}/navigate`, {
          url: args.url,
          waitUntil: args.waitUntil || 'networkidle2',
        });

        // Get content
        const contentResp = browserServerRequest('GET', `/session/${activeSessionId}/content`);

        // Close temp session
        if (tempSession) {
          browserServerRequest('DELETE', `/session/${activeSessionId}`);
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: response.success,
              title: contentResp.title,
              url: contentResp.url,
              contentLength: contentResp.contentLength,
              content: contentResp.content,
              sessionId: tempSession ? undefined : activeSessionId,
            }, null, 2)
          }],
        };
      }

      case 'puppeteer_click': {
        const response = browserServerRequest('POST', `/session/${args.sessionId}/click`, {
          selector: args.selector,
          waitForNavigation: args.waitForNavigation || false,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: response.success,
              newUrl: response.newUrl,
              title: response.title,
              message: `Clicked element: ${args.selector}`,
            }, null, 2)
          }],
        };
      }

      case 'puppeteer_screenshot': {
        const sessionId = args.sessionId;
        const tempSession = !sessionId;

        // Create temp session and navigate if needed
        let activeSessionId = sessionId;
        if (tempSession) {
          if (!args.url) {
            throw new Error('url is required when sessionId is not provided');
          }

          const createResp = browserServerRequest('POST', '/session/create', {
            metadata: { temporary: true },
          });
          activeSessionId = createResp.sessionId;

          // Navigate to URL
          await browserServerRequest('POST', `/session/${activeSessionId}/navigate`, {
            url: args.url,
            waitUntil: 'networkidle2',
          });
        }

        // Take screenshot
        const response = browserServerRequest('POST', `/session/${activeSessionId}/screenshot`, {
          width: args.width || 800,
          height: args.height || 600,
          delay: args.delay || 0,
          waitForSelector: args.waitForSelector,
        });

        // Close temp session
        if (tempSession) {
          browserServerRequest('DELETE', `/session/${activeSessionId}`);
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: response.success,
              screenshot: response.screenshot,
              url: response.url,
              title: response.title,
            }, null, 2)
          }],
        };
      }

      case 'puppeteer_screenshot_debug': {
        const sessionId = args.sessionId;
        const tempSession = !sessionId;

        // Create temp session and navigate if needed
        let activeSessionId = sessionId;
        if (tempSession) {
          if (!args.url) {
            throw new Error('url is required when sessionId is not provided');
          }

          const createResp = browserServerRequest('POST', '/session/create', {
            metadata: { temporary: true },
          });
          activeSessionId = createResp.sessionId;

          await browserServerRequest('POST', `/session/${activeSessionId}/navigate`, {
            url: args.url,
            waitUntil: 'networkidle2',
          });
        }

        // Take screenshot
        const response = browserServerRequest('POST', `/session/${activeSessionId}/screenshot`, {
          width: args.width || 800,
          height: args.height || 600,
          delay: args.delay || 0,
        });

        // Close temp session
        if (tempSession) {
          browserServerRequest('DELETE', `/session/${activeSessionId}`);
        }

        // Save screenshot to file
        const filename = args.filename || `screenshot-${Date.now()}.jpg`;
        const filepath = join(tmpdir(), filename);
        writeFileSync(filepath, Buffer.from(response.screenshot, 'base64'));

        // Open with termux-open
        try {
          execSync(`termux-open "${filepath}"`, { encoding: 'utf8' });
        } catch (error) {
          // termux-open might not return output
        }

        return {
          content: [{
            type: 'text',
            text: `Screenshot saved to ${filepath} and opened in Android viewer\n\nURL: ${response.url}\nTitle: ${response.title}`
          }],
        };
      }

      case 'puppeteer_evaluate': {
        const response = browserServerRequest('POST', `/session/${args.sessionId}/evaluate`, {
          script: args.script,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: response.success,
              result: response.result,
            }, null, 2)
          }],
        };
      }

      case 'get_page_content': {
        const response = browserServerRequest('GET', `/session/${args.sessionId}/content`);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: response.success,
              title: response.title,
              url: response.url,
              contentLength: response.contentLength,
              content: response.content,
            }, null, 2)
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

/**
 * Check if browser server is running
 */
function isBrowserServerRunning() {
  try {
    const result = execSync(
      `proot-distro login alpine -- sh -c ${escapeShellArg('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/health')} 2>/dev/null`,
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    return result === '200';
  } catch (error) {
    return false;
  }
}

/**
 * Start browser server - requires manual startup due to proot limitations
 * Background processes in proot don't persist reliably
 */
function startBrowserServer() {
  console.error('[MCP] ⚠️  Browser server auto-start is not available');
  console.error('[MCP] Please start the browser server manually in a separate terminal:');
  console.error('[MCP]   proot-distro login alpine -- sh -c "cd /root && node browser-server.js"');
  console.error('[MCP] Or use the daemon manager:');
  console.error('[MCP]   bash daemon-manager.sh start');
  return false;
}

/**
 * Ensure browser server is running
 */
function ensureBrowserServer() {
  // Check if server is responding
  if (!isBrowserServerRunning()) {
    console.error('[MCP] Browser server not running, attempting to start...');
    return startBrowserServer();
  } else {
    console.error('[MCP] Browser server already running');
    return true;
  }
}

async function main() {
  // Ensure browser server is running before starting MCP server
  ensureBrowserServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Termux Puppeteer MCP Server v2 (Session-based) running');
}

// Cleanup on exit - browser server runs independently
process.on('SIGINT', () => {
  console.error('[MCP] Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('[MCP] Shutting down...');
  process.exit(0);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
