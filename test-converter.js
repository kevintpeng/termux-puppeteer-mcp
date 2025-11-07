#!/usr/bin/env node

/**
 * Unit tests for the maybeConvertToFileUrl function
 * Tests URL conversion from localhost to file:// protocol
 */

import { execSync } from 'child_process';
import { join } from 'path';
import assert from 'assert';

// Copy the function from index.js for testing
function maybeConvertToFileUrl(url) {
  const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1):(\d+)(\/.*)?$/;
  const match = url.match(localhostPattern);

  if (match) {
    const port = match[2];
    const path = match[3] || '/';

    try {
      const cwd = execSync('pwd', { encoding: 'utf8' }).trim();

      if (path === '/' || path === '/index.html') {
        const filePath = join(cwd, 'index.html');
        return `file://${filePath}`;
      } else if (!path.includes('..')) {
        const filePath = join(cwd, path.substring(1));
        return `file://${filePath}`;
      }
    } catch (e) {
      return url;
    }
  }

  return url;
}

// Test suite
const tests = [
  {
    name: 'Converts localhost URL with default path',
    input: 'http://localhost:8000',
    expected: (result) => result.startsWith('file://') && result.endsWith('/index.html')
  },
  {
    name: 'Converts localhost URL with index.html path',
    input: 'http://localhost:8000/index.html',
    expected: (result) => result.startsWith('file://') && result.endsWith('/index.html')
  },
  {
    name: 'Converts 127.0.0.1 URL',
    input: 'http://127.0.0.1:8000',
    expected: (result) => result.startsWith('file://') && result.endsWith('/index.html')
  },
  {
    name: 'Converts localhost URL with custom port',
    input: 'http://localhost:3000',
    expected: (result) => result.startsWith('file://') && result.endsWith('/index.html')
  },
  {
    name: 'Converts localhost URL with HTTPS',
    input: 'https://localhost:8443',
    expected: (result) => result.startsWith('file://') && result.endsWith('/index.html')
  },
  {
    name: 'Converts localhost URL with nested path',
    input: 'http://localhost:8000/css/style.css',
    expected: (result) => result.startsWith('file://') && result.endsWith('/css/style.css')
  },
  {
    name: 'Converts localhost URL with js path',
    input: 'http://localhost:8000/js/tetris.js',
    expected: (result) => result.startsWith('file://') && result.endsWith('/js/tetris.js')
  },
  {
    name: 'Does not convert paths with parent directory traversal',
    input: 'http://localhost:8000/../etc/passwd',
    expected: (result) => result === 'http://localhost:8000/../etc/passwd'
  },
  {
    name: 'Does not convert external URLs',
    input: 'https://example.com',
    expected: (result) => result === 'https://example.com'
  },
  {
    name: 'Does not convert external URLs with path',
    input: 'https://example.com/path/to/page.html',
    expected: (result) => result === 'https://example.com/path/to/page.html'
  },
  {
    name: 'Does not convert non-localhost IPs',
    input: 'http://192.168.1.1:8000',
    expected: (result) => result === 'http://192.168.1.1:8000'
  },
  {
    name: 'Does not convert file:// URLs',
    input: 'file:///data/index.html',
    expected: (result) => result === 'file:///data/index.html'
  }
];

// Run tests
console.log('🧪 Running URL converter tests...\n');

let passed = 0;
let failed = 0;

for (const test of tests) {
  try {
    const result = maybeConvertToFileUrl(test.input);
    const isValid = typeof test.expected === 'function'
      ? test.expected(result)
      : result === test.expected;

    if (isValid) {
      console.log(`✅ ${test.name}`);
      console.log(`   Input:  ${test.input}`);
      console.log(`   Output: ${result}\n`);
      passed++;
    } else {
      console.log(`❌ ${test.name}`);
      console.log(`   Input:    ${test.input}`);
      console.log(`   Output:   ${result}`);
      console.log(`   Expected: ${typeof test.expected === 'function' ? 'validation function' : test.expected}\n`);
      failed++;
    }
  } catch (error) {
    console.log(`❌ ${test.name}`);
    console.log(`   Error: ${error.message}\n`);
    failed++;
  }
}

// Summary
console.log('='.repeat(50));
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
}
