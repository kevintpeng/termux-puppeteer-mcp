// Simple test to verify the MCP server can start and list tools
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

console.log('Starting MCP server test...');

const serverProcess = spawn('node', ['index.js'], {
  stdio: ['pipe', 'pipe', 'inherit']
});

// Send initialize request
const initRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'test-client',
      version: '1.0.0'
    }
  }
};

// Send list tools request
const listToolsRequest = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
  params: {}
};

let output = '';

serverProcess.stdout.on('data', (data) => {
  output += data.toString();
  console.log('Received:', data.toString());
});

serverProcess.on('close', (code) => {
  console.log(`Server process exited with code ${code}`);
});

// Send requests
serverProcess.stdin.write(JSON.stringify(initRequest) + '\n');
await setTimeout(1000);
serverProcess.stdin.write(JSON.stringify(listToolsRequest) + '\n');
await setTimeout(2000);

serverProcess.kill();

console.log('Test completed!');
console.log('Output:', output);
