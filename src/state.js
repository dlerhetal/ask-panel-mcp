// Shared mutable state for the ask-panel-mcp server.
// Imported by both the HTTP layer (which fulfills panel <-> server traffic)
// and the MCP layer (which registers pending question sets and reads the queue).

const state = {
  // Map<questionSetId, { resolve, reject, questions, title, createdAt }>
  pendingQuestionSets: new Map(),

  // Array of inbound items the user sent from the panel, waiting for Claude
  // to fetch via get_panel_queue. Each item: { type, receivedAt, ...payload }
  panelQueue: [],

  // Set of active SSE response objects (browser tabs currently listening)
  sseClients: new Set(),

  // HTTP port once the server is listening. Set by src/index.js.
  port: null,
};

export default state;
