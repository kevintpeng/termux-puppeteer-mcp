#!/usr/bin/env node

/**
 * Persistent Browser Server for Alpine Linux
 * Manages browser sessions with multi-agent support
 * Runs as a daemon inside Alpine proot container
 */

const express = require('express');
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const { randomUUID } = require('crypto');

const app = express();
app.use(express.json({ limit: '50mb' }));

// Configuration
const CONFIG = {
  PORT: 3000,
  MAX_SESSIONS: 5,
  SESSION_TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes
  MAX_PAGES_PER_SESSION: 10,
  CLEANUP_INTERVAL_MS: 60 * 1000, // 1 minute
};

// Session storage: Map<sessionId, SessionData>
const sessions = new Map();

/**
 * Session data structure
 * @typedef {Object} SessionData
 * @property {string} id - Unique session ID
 * @property {Browser} browser - Puppeteer browser instance
 * @property {Page[]} pages - Array of open pages
 * @property {number} lastAccessed - Timestamp of last activity
 * @property {string} currentUrl - Current URL (for stateless fallback)
 * @property {Object} metadata - Custom metadata (agent ID, etc.)
 */

// Browser launch configuration
const BROWSER_CONFIG = {
  executablePath: '/usr/bin/chromium-browser',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu-sandbox',
    '--no-first-run',
    '--no-zygote',
    '--single-process', // Run in single process mode to avoid signal 9 on subprocess crashes
    '--disable-features=VizDisplayCompositor',
  ],
  headless: true,
};

// ============================================================================
// Session Management
// ============================================================================

/**
 * Create a new browser session
 */
async function createSession(metadata = {}) {
  // Check session limit
  if (sessions.size >= CONFIG.MAX_SESSIONS) {
    // Try to clean up expired sessions first
    await cleanupExpiredSessions();

    if (sessions.size >= CONFIG.MAX_SESSIONS) {
      throw new Error(`Maximum session limit reached (${CONFIG.MAX_SESSIONS})`);
    }
  }

  const sessionId = `ses_${randomUUID()}`;
  const browser = await puppeteer.launch(BROWSER_CONFIG);

  const sessionData = {
    id: sessionId,
    browser,
    pages: [],
    lastAccessed: Date.now(),
    currentUrl: null,
    metadata: metadata || {},
  };

  sessions.set(sessionId, sessionData);

  console.log(`[SESSION] Created: ${sessionId} | Total: ${sessions.size}`);

  return sessionData;
}

/**
 * Get session by ID
 */
function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // Update last accessed time
  session.lastAccessed = Date.now();

  return session;
}

/**
 * Get or create the current page for a session
 */
async function getCurrentPage(session) {
  // If no pages exist, create one
  if (session.pages.length === 0) {
    const page = await session.browser.newPage();
    session.pages.push(page);
    return page;
  }

  // Return the most recently used page
  return session.pages[session.pages.length - 1];
}

/**
 * Destroy a session and clean up resources
 */
async function destroySession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return false;
  }

  try {
    // Close all pages
    for (const page of session.pages) {
      try {
        await page.close();
      } catch (e) {
        console.error(`[SESSION] Error closing page: ${e.message}`);
      }
    }

    // Close browser
    await session.browser.close();
  } catch (error) {
    console.error(`[SESSION] Error destroying session ${sessionId}:`, error.message);
  }

  sessions.delete(sessionId);
  console.log(`[SESSION] Destroyed: ${sessionId} | Remaining: ${sessions.size}`);

  return true;
}

/**
 * Clean up expired sessions
 */
async function cleanupExpiredSessions() {
  const now = Date.now();
  const expiredSessions = [];

  for (const [sessionId, session] of sessions.entries()) {
    const idleTime = now - session.lastAccessed;
    if (idleTime > CONFIG.SESSION_TIMEOUT_MS) {
      expiredSessions.push(sessionId);
    }
  }

  for (const sessionId of expiredSessions) {
    console.log(`[CLEANUP] Expiring session: ${sessionId} (idle for ${Math.round((now - sessions.get(sessionId).lastAccessed) / 1000)}s)`);
    await destroySession(sessionId);
  }

  return expiredSessions.length;
}

// ============================================================================
// API Routes
// ============================================================================

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    sessions: sessions.size,
    maxSessions: CONFIG.MAX_SESSIONS,
    uptime: process.uptime(),
  });
});

/**
 * Create a new session
 * POST /session/create
 * Body: { metadata?: object }
 */
app.post('/session/create', async (req, res) => {
  try {
    const session = await createSession(req.body.metadata);

    res.json({
      success: true,
      sessionId: session.id,
      metadata: session.metadata,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Get session info
 * GET /session/:id/info
 */
app.get('/session/:id/info', (req, res) => {
  try {
    const session = getSession(req.params.id);

    res.json({
      success: true,
      session: {
        id: session.id,
        pagesCount: session.pages.length,
        currentUrl: session.currentUrl,
        lastAccessed: session.lastAccessed,
        idleTime: Date.now() - session.lastAccessed,
        metadata: session.metadata,
      },
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Navigate to a URL
 * POST /session/:id/navigate
 * Body: { url: string, waitUntil?: string }
 */
app.post('/session/:id/navigate', async (req, res) => {
  try {
    const session = getSession(req.params.id);
    const { url, waitUntil = 'networkidle2' } = req.body;

    const page = await getCurrentPage(session);
    await page.setViewport({ width: 800, height: 600 });
    await page.goto(url, { waitUntil });

    session.currentUrl = url;

    const title = await page.title();
    const pageUrl = page.url();

    res.json({
      success: true,
      title,
      url: pageUrl,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Click an element
 * POST /session/:id/click
 * Body: { selector: string, waitForNavigation?: boolean }
 */
app.post('/session/:id/click', async (req, res) => {
  try {
    const session = getSession(req.params.id);
    const { selector, waitForNavigation = false } = req.body;

    const page = await getCurrentPage(session);

    if (waitForNavigation) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click(selector),
      ]);
    } else {
      await page.click(selector);
    }

    const newUrl = page.url();
    const title = await page.title();
    session.currentUrl = newUrl;

    res.json({
      success: true,
      newUrl,
      title,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Take a screenshot
 * POST /session/:id/screenshot
 * Body: { width?: number, height?: number, delay?: number, waitForSelector?: string }
 */
app.post('/session/:id/screenshot', async (req, res) => {
  try {
    const session = getSession(req.params.id);
    const {
      width = 800,
      height = 600,
      delay = 0,
      waitForSelector,
    } = req.body;

    const page = await getCurrentPage(session);
    await page.setViewport({ width, height });

    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 10000 });
    }

    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    const screenshotBuffer = await page.screenshot({
      type: 'png',
      fullPage: false,
    });

    // Scale down to max 800x600 while preserving aspect ratio
    const resized = await sharp(screenshotBuffer)
      .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 60 })
      .toBuffer();

    const screenshot = resized.toString('base64');

    res.json({
      success: true,
      screenshot,
      url: page.url(),
      title: await page.title(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Evaluate JavaScript in page context
 * POST /session/:id/evaluate
 * Body: { script: string }
 */
app.post('/session/:id/evaluate', async (req, res) => {
  try {
    const session = getSession(req.params.id);
    const { script } = req.body;

    const page = await getCurrentPage(session);

    // Evaluate the script in the page context
    const result = await page.evaluate((scriptToRun) => {
      // Use Function constructor to allow return statements
      const fn = new Function(scriptToRun);
      return fn();
    }, script);

    res.json({
      success: true,
      result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Get page content
 * GET /session/:id/content
 */
app.get('/session/:id/content', async (req, res) => {
  try {
    const session = getSession(req.params.id);
    const page = await getCurrentPage(session);

    const content = await page.content();
    const title = await page.title();
    const url = page.url();

    res.json({
      success: true,
      title,
      url,
      content: content.substring(0, 10000), // Limit content size
      contentLength: content.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Close/destroy a session
 * DELETE /session/:id
 */
app.delete('/session/:id', async (req, res) => {
  try {
    const destroyed = await destroySession(req.params.id);

    res.json({
      success: destroyed,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * List all active sessions
 * GET /sessions
 */
app.get('/sessions', (req, res) => {
  const sessionList = Array.from(sessions.values()).map(session => ({
    id: session.id,
    pagesCount: session.pages.length,
    currentUrl: session.currentUrl,
    lastAccessed: session.lastAccessed,
    idleTime: Date.now() - session.lastAccessed,
    metadata: session.metadata,
  }));

  res.json({
    success: true,
    sessions: sessionList,
    count: sessionList.length,
  });
});

// ============================================================================
// Cleanup & Lifecycle
// ============================================================================

// Periodic cleanup of expired sessions
const cleanupInterval = setInterval(async () => {
  const cleaned = await cleanupExpiredSessions();
  if (cleaned > 0) {
    console.log(`[CLEANUP] Removed ${cleaned} expired session(s)`);
  }
}, CONFIG.CLEANUP_INTERVAL_MS);

// Graceful shutdown
async function shutdown() {
  console.log('\n[SERVER] Shutting down gracefully...');

  clearInterval(cleanupInterval);

  // Close all sessions
  const sessionIds = Array.from(sessions.keys());
  for (const sessionId of sessionIds) {
    await destroySession(sessionId);
  }

  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ============================================================================
// Start Server
// ============================================================================

const server = app.listen(CONFIG.PORT, '0.0.0.0', () => {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Puppeteer Browser Server for Alpine Linux                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`[SERVER] Listening on http://0.0.0.0:${CONFIG.PORT}`);
  console.log(`[CONFIG] Max Sessions: ${CONFIG.MAX_SESSIONS}`);
  console.log(`[CONFIG] Session Timeout: ${CONFIG.SESSION_TIMEOUT_MS / 1000}s`);
  console.log(`[CONFIG] Cleanup Interval: ${CONFIG.CLEANUP_INTERVAL_MS / 1000}s`);
  console.log('Ready to accept requests.');
});
