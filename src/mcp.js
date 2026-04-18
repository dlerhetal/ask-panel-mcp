import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import open from 'open';
import state from './state.js';
import { broadcast, hasConnectedClient } from './http.js';

const TOOLS = [
  {
    name: 'ask_user_questions',
    description:
      "Push a batch of structured questions to the user's browser panel and wait for their answers. Use this to gather decisions, clarifications, or requirements mid-conversation instead of asking in prose. The panel opens automatically on first use. Supported field types: text, textarea, select, multiselect, number, date, file. Number and date return strings; file returns an object with originalName, mimeType, size, and diskPath. For ad-hoc attachments outside a question set, the user can drop files in the Send zone and you call get_panel_queue.",
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Optional heading shown above the question set.',
        },
        questions: {
          type: 'array',
          minItems: 1,
          description: 'One or more questions to present as a single form.',
          items: {
            type: 'object',
            required: ['id', 'label', 'type'],
            properties: {
              id: {
                type: 'string',
                description: 'Unique key for this question. Used as the key in the returned answers object.',
              },
              label: {
                type: 'string',
                description: 'Question text shown to the user.',
              },
              type: {
                type: 'string',
                enum: ['text', 'textarea', 'select', 'multiselect', 'number', 'date', 'file'],
                description: 'Field type.',
              },
              options: {
                type: 'array',
                items: { type: 'string' },
                description: 'Choices for select and multiselect.',
              },
              placeholder: {
                type: 'string',
                description: 'Placeholder text for text, textarea, and number fields.',
              },
              min: {
                type: 'number',
                description: 'Minimum value for number fields.',
              },
              max: {
                type: 'number',
                description: 'Maximum value for number fields.',
              },
              step: {
                type: 'number',
                description: 'Step value for number fields. Defaults to 1 for integers, 0.01 for decimals.',
              },
              accept: {
                type: 'string',
                description: 'MIME filter for file fields (e.g. "image/*" or ".pdf,.csv"). Optional.',
              },
              required: {
                type: 'boolean',
                description: 'Whether the field must be filled before submit. Defaults to true.',
              },
            },
          },
        },
      },
      required: ['questions'],
    },
  },
  {
    name: 'get_panel_queue',
    description:
      "Fetch anything the user has sent from the panel's Send zone (pasted screenshots, dragged-in files, typed notes) since the last call. Returns items inline (images as image content, text as text content, other files as text references with the server-side path) and clears the queue. Call this when the user refers to something they sent or when you suspect they pasted/dropped something.",
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

async function ensurePanelOpen() {
  if (hasConnectedClient()) return;
  const url = `http://localhost:${state.port}/`;
  try {
    await open(url);
  } catch (err) {
    console.error(`[ask-panel-mcp] Could not auto-open browser. Open manually: ${url}`);
  }
}

async function handleAskQuestions(args) {
  const questions = Array.isArray(args?.questions) ? args.questions : [];
  const title = typeof args?.title === 'string' ? args.title : undefined;

  if (questions.length === 0) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'ask_user_questions called with no questions.' }],
    };
  }

  const id = randomUUID();
  const answerPromise = new Promise((resolve, reject) => {
    state.pendingQuestionSets.set(id, {
      resolve,
      reject,
      questions,
      title,
      createdAt: Date.now(),
    });
  });

  await ensurePanelOpen();
  broadcast('questions', { id, questions, title });

  const answers = await answerPromise;
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(answers, null, 2),
      },
    ],
  };
}

async function handleGetQueue() {
  await ensurePanelOpen();
  const items = state.panelQueue.splice(0);

  if (items.length === 0) {
    return {
      content: [{ type: 'text', text: 'Panel queue is empty. Nothing to fetch.' }],
    };
  }

  const content = [];
  for (const item of items) {
    if (item.type === 'image') {
      content.push({ type: 'image', data: item.data, mimeType: item.mimeType });
      content.push({
        type: 'text',
        text: `(Image above: ${item.originalName}, ${item.mimeType}, ${item.size} bytes, saved at ${item.diskPath})`,
      });
    } else if (item.type === 'text') {
      content.push({ type: 'text', text: item.text });
    } else {
      content.push({
        type: 'text',
        text: `File attached: ${item.originalName} (${item.mimeType}, ${item.size} bytes). Server-side path: ${item.diskPath}`,
      });
    }
  }
  return { content };
}

export function createMcpServer() {
  const server = new Server(
    { name: 'ask-panel-mcp', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name === 'ask_user_questions') return handleAskQuestions(args);
    if (name === 'get_panel_queue') return handleGetQueue();
    return {
      isError: true,
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    };
  });

  return server;
}

export async function startMcpServer() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
