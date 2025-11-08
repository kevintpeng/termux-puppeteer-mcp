#!/usr/bin/env node

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
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Helper function to execute code in Alpine with Puppeteer
function runInAlpine(code) {
  const scriptPath = `/root/mcp-script-${Date.now()}.js`;
  const tempLocalScript = join('/data/data/com.termux/files/home', `temp-${Date.now()}.js`);

  // Write the script locally first
  writeFileSync(tempLocalScript, code);

  try {
    // Copy script to Alpine and execute
    const result = execSync(
      `proot-distro login alpine -- sh -c "cat > ${scriptPath} << 'EOFSCRIPT'\n${code}\nEOFSCRIPT\nnode ${scriptPath} && rm ${scriptPath}"`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );

    unlinkSync(tempLocalScript);
    return result;
  } catch (error) {
    unlinkSync(tempLocalScript);
    throw new Error(`Alpine execution failed: ${error.message}\nStderr: ${error.stderr}`);
  }
}

// Define Puppeteer tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'puppeteer_navigate',
        description: 'Navigate to a URL and get the page content, title, and optionally take a screenshot',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to navigate to',
            },
            screenshot: {
              type: 'boolean',
              description: 'Whether to take a screenshot (returns base64)',
              default: false,
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'puppeteer_screenshot',
        description: 'Take a screenshot of a URL and return it as base64 JPEG. Accepts any viewport dimensions and automatically scales down to fit 800x600 while preserving aspect ratio.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to screenshot',
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
              description: 'Additional delay in milliseconds to wait after page load (for animations)',
              default: 0,
            },
            waitUntil: {
              type: 'string',
              description: 'When to consider navigation finished: load, domcontentloaded, networkidle0, or networkidle2',
              default: 'networkidle2',
            },
            waitForSelector: {
              type: 'string',
              description: 'CSS selector to wait for before taking screenshot',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'puppeteer_pdf',
        description: 'Generate a PDF from a URL and return it as base64',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to convert to PDF',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'puppeteer_evaluate',
        description: 'Execute JavaScript code in the context of a page and return the result',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to navigate to',
            },
            script: {
              type: 'string',
              description: 'JavaScript code to execute in the page context',
            },
          },
          required: ['url', 'script'],
        },
      },
      {
        name: 'puppeteer_click',
        description: 'Navigate to a URL, click an element, and return the result',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to navigate to',
            },
            selector: {
              type: 'string',
              description: 'CSS selector for the element to click',
            },
            waitForNavigation: {
              type: 'boolean',
              description: 'Wait for navigation after click',
              default: false,
            },
          },
          required: ['url', 'selector'],
        },
      },
      {
        name: 'puppeteer_screenshot_debug',
        description: 'Take a screenshot and save it to a file, then open it with termux-open for debugging',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to screenshot',
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
              description: 'Additional delay in milliseconds to wait after page load (for animations)',
              default: 0,
            },
            waitUntil: {
              type: 'string',
              description: 'When to consider navigation finished: load, domcontentloaded, networkidle0, or networkidle2',
              default: 'networkidle2',
            },
            waitForSelector: {
              type: 'string',
              description: 'CSS selector to wait for before taking screenshot',
            },
          },
          required: ['url'],
        },
      },
    ],
  };
});

// Helper to convert localhost URLs to file:// URLs when running locally
function maybeConvertToFileUrl(url) {
  // If it's a localhost URL pointing to a local server, we need to handle it differently
  // since Alpine proot can't access Termux's localhost ports
  const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1):(\d+)(\/.*)?$/;
  const match = url.match(localhostPattern);

  if (match) {
    const port = match[2];
    const path = match[3] || '/';

    // Check if we're serving from current directory
    // Get the current working directory from Termux
    try {
      const cwd = execSync('pwd', { encoding: 'utf8' }).trim();

      // If path is just '/' or '/index.html', convert to file:// URL
      if (path === '/' || path === '/index.html') {
        const filePath = join(cwd, 'index.html');
        return `file://${filePath}`;
      } else if (!path.includes('..')) {
        // For other paths, try to resolve them
        const filePath = join(cwd, path.substring(1)); // Remove leading /
        return `file://${filePath}`;
      }
    } catch (e) {
      // If we can't convert, return original URL and let it fail with helpful error
      return url;
    }
  }

  return url;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Convert localhost URLs to file:// URLs when appropriate
    if (args.url) {
      args.url = maybeConvertToFileUrl(args.url);
    }

    switch (name) {
      case 'puppeteer_navigate': {
        const code = `
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });
  await page.goto('${args.url}', { waitUntil: 'networkidle2' });
  const title = await page.title();
  const content = await page.content();
  ${args.screenshot ? `
  const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 60 });
  console.log(JSON.stringify({ title, contentLength: content.length, screenshot }));
  ` : `
  console.log(JSON.stringify({ title, contentLength: content.length, content: content.substring(0, 5000) }));
  `}
  await browser.close();
})();
`;
        const result = runInAlpine(code);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'puppeteer_screenshot': {
        // Allow any viewport size, but scale down afterwards to stay under token limit
        const width = args.width || 800;
        const height = args.height || 600;
        const delay = args.delay || 0;
        const waitUntil = args.waitUntil || 'networkidle2';
        const waitForSelector = args.waitForSelector || '';
        const code = `
const puppeteer = require('puppeteer');
const sharp = require('sharp');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true
  });
  const page = await browser.newPage();
  await page.setViewport({ width: ${width}, height: ${height} });
  await page.goto('${args.url}', { waitUntil: '${waitUntil}' });
  ${waitForSelector ? `await page.waitForSelector('${waitForSelector.replace(/'/g, "\\'")}', { timeout: 10000 });` : ''}
  ${delay > 0 ? `await new Promise(resolve => setTimeout(resolve, ${delay}));` : ''}
  const screenshotBuffer = await page.screenshot({
    type: 'png',
    fullPage: false
  });

  // Scale down to max 800x600 while preserving aspect ratio
  const resized = await sharp(screenshotBuffer)
    .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 60 })
    .toBuffer();

  const screenshot = resized.toString('base64');
  console.log(JSON.stringify({ screenshot }));
  await browser.close();
})();
`;
        const result = runInAlpine(code);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'puppeteer_pdf': {
        const code = `
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true
  });
  const page = await browser.newPage();
  await page.goto('${args.url}', { waitUntil: 'networkidle2' });
  const pdf = await page.pdf({ format: 'A4' });
  console.log(JSON.stringify({ pdf: pdf.toString('base64') }));
  await browser.close();
})();
`;
        const result = runInAlpine(code);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'puppeteer_evaluate': {
        const escapedScript = args.script.replace(/`/g, '\\`').replace(/\$/g, '\\$');
        const code = `
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true
  });
  const page = await browser.newPage();
  await page.goto('${args.url}', { waitUntil: 'networkidle2' });
  const result = await page.evaluate(async () => {
    ${escapedScript}
  });
  console.log(JSON.stringify({ result }));
  await browser.close();
})();
`;
        const result = runInAlpine(code);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'puppeteer_click': {
        const escapedSelector = args.selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const code = `
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true
  });
  const page = await browser.newPage();
  await page.goto('${args.url}', { waitUntil: 'networkidle2' });
  ${args.waitForNavigation ? `
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }),
    page.click('${escapedSelector}')
  ]);
  ` : `
  await page.click('${escapedSelector}');
  `}
  const newUrl = page.url();
  const title = await page.title();
  console.log(JSON.stringify({ success: true, newUrl, title }));
  await browser.close();
})();
`;
        const result = runInAlpine(code);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'puppeteer_screenshot_debug': {
        const width = args.width || 800;
        const height = args.height || 600;
        const filename = args.filename || `screenshot-${Date.now()}.jpg`;
        const delay = args.delay || 0;
        const waitUntil = args.waitUntil || 'networkidle2';
        const waitForSelector = args.waitForSelector || '';

        const code = `
const puppeteer = require('puppeteer');
const sharp = require('sharp');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true
  });
  const page = await browser.newPage();
  await page.setViewport({ width: ${width}, height: ${height} });
  await page.goto('${args.url}', { waitUntil: '${waitUntil}' });
  ${waitForSelector ? `await page.waitForSelector('${waitForSelector.replace(/'/g, "\\'")}', { timeout: 10000 });` : ''}
  ${delay > 0 ? `await new Promise(resolve => setTimeout(resolve, ${delay}));` : ''}
  const screenshotBuffer = await page.screenshot({
    type: 'png',
    fullPage: false
  });

  // Convert to JPEG for better compatibility
  const jpeg = await sharp(screenshotBuffer)
    .jpeg({ quality: 80 })
    .toBuffer();

  const screenshot = jpeg.toString('base64');
  console.log(JSON.stringify({ screenshot }));
  await browser.close();
})();
`;
        const result = runInAlpine(code);
        const data = JSON.parse(result);

        // Write screenshot to temp directory
        const filepath = join(tmpdir(), filename);
        writeFileSync(filepath, Buffer.from(data.screenshot, 'base64'));

        // Open with termux-open
        try {
          execSync(`termux-open "${filepath}"`, { encoding: 'utf8' });
        } catch (error) {
          // termux-open might not return output, so ignore errors here
        }

        return {
          content: [{ type: 'text', text: `Screenshot saved to ${filepath} and opened in Android viewer` }],
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Termux Puppeteer MCP server running');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
