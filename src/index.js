#!/usr/bin/env node
import { createApp } from './http.js';
import { startMcpServer } from './mcp.js';
import state from './state.js';

async function main() {
  const app = createApp();

  await new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      state.port = server.address().port;
      console.error(`[ask-panel-mcp] panel: http://localhost:${state.port}`);
      resolve();
    });
    server.on('error', reject);
  });

  // Standalone smoke-test mode: `node src/index.js --standalone` runs only the HTTP panel,
  // skipping the MCP stdio loop. Also triggered automatically when stdin is a TTY
  // (interactive shell, no MCP client piping JSON-RPC in).
  const standalone = process.argv.includes('--standalone') || process.stdin.isTTY;
  if (standalone) {
    console.error('[ask-panel-mcp] standalone mode (no MCP client). Open the URL above to test the panel UI.');
    console.error('[ask-panel-mcp] Ctrl+C to stop.');
    return;
  }

  await startMcpServer();
}

main().catch((err) => {
  console.error('[ask-panel-mcp] fatal:', err);
  process.exit(1);
});
