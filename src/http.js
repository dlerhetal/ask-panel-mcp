import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import state from './state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const uploadsDir = path.join(__dirname, '..', 'temp-uploads');
const notesPath = path.join(__dirname, '..', 'notes.jsonl');

await fs.mkdir(uploadsDir, { recursive: true });

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB per file
});

async function appendNote(entry) {
  try {
    await fs.appendFile(notesPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    /* note logging is best-effort; never fail the request */
  }
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.static(publicDir));

  // SSE stream. Panel subscribes here for live question pushes.
  app.get('/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(': connected\n\n');
    state.sseClients.add(res);

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* client gone */ }
    }, 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
      state.sseClients.delete(res);
    });
  });

  // Panel asks for anything it missed while not connected.
  app.get('/bootstrap', (req, res) => {
    const pending = [];
    for (const [id, { questions, title }] of state.pendingQuestionSets) {
      pending.push({ id, questions, title });
    }
    res.json({ pending });
  });

  // Panel submits answers for a question set. Accepts either JSON
  // (for text-only answers) or multipart/form-data (when any question
  // is type 'file' — files are attached under their question id).
  app.post('/answers', upload.any(), (req, res) => {
    const id = req.body?.id;
    let answers = req.body?.answers;
    if (typeof answers === 'string') {
      try { answers = JSON.parse(answers); } catch { answers = {}; }
    }
    answers = answers || {};

    for (const file of (req.files || [])) {
      answers[file.fieldname] = {
        originalName: file.originalname || path.basename(file.path),
        mimeType: file.mimetype || 'application/octet-stream',
        size: file.size,
        diskPath: file.path,
      };
    }

    const pending = state.pendingQuestionSets.get(id);
    if (!pending) {
      return res.status(404).json({ error: 'unknown or already-answered question set' });
    }
    state.pendingQuestionSets.delete(id);
    pending.resolve(answers);
    res.json({ ok: true });
  });

  // Panel sends files and/or a text note into the queue.
  app.post('/send', upload.array('files'), async (req, res) => {
    const notes = (req.body && req.body.notes) || '';
    const queued = [];

    if (notes && notes.trim()) {
      const trimmed = notes.trim();
      state.panelQueue.push({
        type: 'text',
        text: trimmed,
        receivedAt: Date.now(),
      });
      queued.push({ kind: 'note' });
      await appendNote({
        ts: new Date().toISOString(),
        kind: 'text',
        text: trimmed,
      });
    }

    for (const file of (req.files || [])) {
      try {
        const buf = await fs.readFile(file.path);
        const base64 = buf.toString('base64');
        const isImage = (file.mimetype || '').startsWith('image/');
        state.panelQueue.push({
          type: isImage ? 'image' : 'file',
          mimeType: file.mimetype || 'application/octet-stream',
          data: base64,
          originalName: file.originalname || path.basename(file.path),
          size: file.size,
          diskPath: file.path,
          receivedAt: Date.now(),
        });
        queued.push({ kind: isImage ? 'image' : 'file', name: file.originalname });
        await appendNote({
          ts: new Date().toISOString(),
          kind: isImage ? 'image' : 'file',
          name: file.originalname,
          mime: file.mimetype,
          size: file.size,
          path: file.path,
        });
      } catch (err) {
        queued.push({ kind: 'error', name: file.originalname, error: err.message });
      }
    }

    res.json({ ok: true, queued });
  });

  return app;
}

export function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of state.sseClients) {
    try { client.write(payload); } catch { /* client will be cleaned up on close */ }
  }
}

export function hasConnectedClient() {
  return state.sseClients.size > 0;
}
