# ask-panel-mcp

An MCP server that opens a persistent browser panel alongside your terminal. Claude pushes structured questions into it; you answer, paste screenshots, drop files, or type notes and click Send. No more breaking out to File Explorer or copy-pasting filenames.

## Why

Long back-and-forth requirements conversations in Claude Code have two rough edges:

1. Claude asks several questions in prose — you answer in prose — you miss one, Claude re-asks — repeat.
2. You need to hand Claude a screenshot or file. The native CLI paste doesn't always work. You fall back to screenshotting, saving, copying the filename, pasting into the terminal. By the time you're back you've lost your train of thought.

This puts a small, persistent browser tab next to your terminal. Claude pushes structured forms into it (text, textarea, select, multiselect). You paste Ctrl+V screenshots, drag-drop files, or type notes into the always-visible Send zone and click Send — Claude picks them up on the next tool call.

## Prior art / credit

Architecturally modeled on [AskMeMCP](https://github.com/thlandgraf/askme-mcp) (MIT). Same stdio + embedded HTTP + SSE + auto-open-browser pattern. This project is a leaner re-implementation with built-in paste / drag-drop image support and no Angular dependency.

Other projects worth knowing in this space:
- [GongRzhe/Human-In-the-Loop-MCP-Server](https://github.com/GongRzhe/Human-In-the-Loop-MCP-Server) — Tkinter native dialogs, not browser
- [upamune/human-mcp](https://github.com/upamune/human-mcp) — Streamlit UI

## Install

```bash
git clone https://github.com/dlerhetal/ask-panel-mcp.git
cd ask-panel-mcp
npm install
```

Test it standalone first:

```bash
npm start
```

Open the URL it prints. You should see the panel.

## Configure in Claude Code

Add to your user-scope config (`~/.claude.json`) under `mcpServers`:

```json
{
  "mcpServers": {
    "ask-panel": {
      "command": "node",
      "args": ["/absolute/path/to/ask-panel-mcp/src/index.js"]
    }
  }
}
```

On Windows bash-style paths work: `"C:/dev/ask-panel-mcp/src/index.js"`.

Start a fresh Claude Code session. The panel opens automatically the first time Claude calls `ask_user_questions` or `get_panel_queue`.

## Tools

### `ask_user_questions`

Push a batch of 1+ questions to the panel and wait for answers.

Field types: `text`, `textarea`, `select`, `multiselect`.

File attachments are intentionally *not* a question field type. Claude asks in a text question ("attach the spreadsheet"), you drop the file in the always-visible Send zone, Claude calls `get_panel_queue` to fetch it. This keeps question flow simple and makes file attachments work the same way whether you were asked or volunteered.

Example call (what Claude sends):

```json
{
  "title": "ask-panel-mcp setup",
  "questions": [
    { "id": "name", "label": "Project name?", "type": "text" },
    { "id": "stack", "label": "Stack?", "type": "select", "options": ["Node", "Python"] }
  ]
}
```

Returns: `{"name": "...", "stack": "..."}`

### `get_panel_queue`

Returns anything you've pasted, dropped, or typed in the Send zone since the last call, then clears the queue. Images come back inline as image content; text notes come back as text; other files come back as text references with a path.

## Field trust & security

The server binds to `127.0.0.1` on a random ephemeral port. No auth — anyone with access to your local machine can POST to it. Don't run this on a shared host.

## License

MIT. See LICENSE.
