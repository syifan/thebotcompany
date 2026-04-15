/**
 * Chat Engine — interactive chat sessions with AI agent per project.
 * 
 * Manages chat sessions in SQLite, streams LLM responses via SSE,
 * and executes tools in a git worktree separate from agent notes.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { streamSimple } from '@mariozechner/pi-ai';
import {
  resolveModel,
  formatTools,
  callModel,
  buildUserMessage,
  buildToolResultMessages,
} from './providers/index.js';
import { executeToolDetailed } from './agent-runner.js';

// ---------------------------------------------------------------------------
// Active stream tracking — in-memory state for reconnection
// ---------------------------------------------------------------------------

// Map of active streams: chatSessionId -> { text, toolCalls, sseClients }
const activeStreams = new Map();

export function getActiveStream(chatId) {
  return activeStreams.get(chatId) || null;
}

export function isStreaming(chatId) {
  return activeStreams.has(chatId);
}

// ---------------------------------------------------------------------------
// Worktree management
// ---------------------------------------------------------------------------

/**
 * Ensure a git worktree exists for chat tool execution.
 * Creates `repo-chat/` alongside the project repo if it doesn't exist.
 */
function ensureWorktree(projectPath) {
  const worktreePath = path.join(projectPath, '..', 'repo-chat');
  if (fs.existsSync(worktreePath)) return worktreePath;

  try {
    // Get default branch
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectPath,
      encoding: 'utf-8',
    }).trim();

    execSync(`git worktree add ${JSON.stringify(worktreePath)} ${branch}`, {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch (err) {
    // If worktree already exists or branch issues, try detached
    if (!fs.existsSync(worktreePath)) {
      try {
        execSync(`git worktree add --detach ${JSON.stringify(worktreePath)}`, {
          cwd: projectPath,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      } catch {
        // Last resort: just use the project path
        return projectPath;
      }
    }
  }

  return worktreePath;
}

// ---------------------------------------------------------------------------
// Chat DB helpers
// ---------------------------------------------------------------------------

function getChatDb(agentDir) {
  const dbPath = path.join(agentDir, 'project.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'New Chat',
      selected_key_id TEXT DEFAULT NULL,
      selected_model TEXT DEFAULT NULL,

      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT DEFAULT '',
      tool_calls TEXT DEFAULT NULL,
      success INTEGER DEFAULT NULL,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
  `);
  try {
    db.prepare('ALTER TABLE chat_messages ADD COLUMN success INTEGER DEFAULT NULL').run();
  } catch {}
  try {
    db.prepare('ALTER TABLE chat_sessions ADD COLUMN selected_key_id TEXT DEFAULT NULL').run();
  } catch {}
  try {
    db.prepare('ALTER TABLE chat_sessions ADD COLUMN selected_model TEXT DEFAULT NULL').run();
  } catch {}

  return db;
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export function listSessions(agentDir) {
  const db = getChatDb(agentDir);
  try {
    const sessions = db.prepare(`
      SELECT s.*, 
        (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id) as message_count
      FROM chat_sessions s
      ORDER BY s.updated_at DESC
    `).all();
    return sessions;
  } finally {
    db.close();
  }
}

export function createSession(agentDir, title, opts = {}) {
  const db = getChatDb(agentDir);
  try {
    const selectedKeyId = typeof opts.selectedKeyId === 'string' && opts.selectedKeyId.trim() ? opts.selectedKeyId.trim() : null;
    const selectedModel = typeof opts.selectedModel === 'string' && opts.selectedModel.trim() ? opts.selectedModel.trim() : null;
    const result = db.prepare('INSERT INTO chat_sessions (title, selected_key_id, selected_model) VALUES (?, ?, ?)').run(
      title || 'New Chat',
      selectedKeyId,
      selectedModel,
    );
    return db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(result.lastInsertRowid);
  } finally {
    db.close();
  }
}

export function getSession(agentDir, chatId) {
  const db = getChatDb(agentDir);
  try {
    const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(chatId);
    if (!session) return null;
    const messages = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC').all(chatId);
    return { ...session, messages };
  } finally {
    db.close();
  }
}

export function deleteSession(agentDir, chatId) {
  const db = getChatDb(agentDir);
  try {
    db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(chatId);
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(chatId);
  } finally {
    db.close();
  }
}

export function updateSessionPreferences(agentDir, chatId, opts = {}) {
  const db = getChatDb(agentDir);
  try {
    const selectedKeyId = typeof opts.selectedKeyId === 'string' && opts.selectedKeyId.trim() ? opts.selectedKeyId.trim() : null;
    const selectedModel = typeof opts.selectedModel === 'string' && opts.selectedModel.trim() ? opts.selectedModel.trim() : null;
    db.prepare(`
      UPDATE chat_sessions
      SET selected_key_id = ?,
          selected_model = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?
    `).run(selectedKeyId, selectedModel, chatId);
    return db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(chatId);
  } finally {
    db.close();
  }
}

export function saveMessage(agentDir, sessionId, role, content, toolCalls = null, opts = {}) {
  const db = getChatDb(agentDir);
  try {
    const success = opts.success === undefined || opts.success === null ? null : (opts.success ? 1 : 0);
    db.prepare(
      'INSERT INTO chat_messages (session_id, role, content, tool_calls, success) VALUES (?, ?, ?, ?, ?)'
    ).run(sessionId, role, content, toolCalls ? JSON.stringify(toolCalls) : null, success);
    db.prepare(
      "UPDATE chat_sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"
    ).run(sessionId);
  } finally {
    db.close();
  }
}

// Auto-title: use first ~50 chars of user message
function maybeUpdateTitle(agentDir, sessionId, userMessage) {
  const db = getChatDb(agentDir);
  try {
    const session = db.prepare('SELECT title FROM chat_sessions WHERE id = ?').get(sessionId);
    if (session && session.title === 'New Chat') {
      const title = userMessage.slice(0, 60).replace(/\n/g, ' ').trim() || 'Chat';
      db.prepare('UPDATE chat_sessions SET title = ? WHERE id = ?').run(title, sessionId);
    }
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Tool definitions for chat (same as agent-runner)
// ---------------------------------------------------------------------------

function getChatToolDefinitions() {
  return [
    {
      name: 'Bash',
      description: 'Execute a bash command in the project worktree. Returns stdout and stderr.',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' },
          timeout: { type: 'number', description: 'Optional timeout in milliseconds (default 30000, max 120000)' },
        },
        required: ['command'],
      },
    },
    {
      name: 'Read',
      description: 'Read a file from the project. Returns file contents with line numbers.',
      input_schema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the file to read (relative to project root or absolute)' },
          offset: { type: 'number', description: 'Line number to start reading from (1-indexed)' },
          limit: { type: 'number', description: 'Number of lines to read' },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'Write',
      description: 'Write content to a file in the project worktree.',
      input_schema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the file to write' },
          content: { type: 'string', description: 'The content to write' },
        },
        required: ['file_path', 'content'],
      },
    },
    {
      name: 'Edit',
      description: 'Perform exact string replacement in a file.',
      input_schema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the file to edit' },
          old_string: { type: 'string', description: 'The exact string to find' },
          new_string: { type: 'string', description: 'The replacement string' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
    {
      name: 'Glob',
      description: 'Find files matching a glob pattern.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.js")' },
          path: { type: 'string', description: 'Directory to search in' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'Grep',
      description: 'Search file contents using regex.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern' },
          path: { type: 'string', description: 'File or directory to search' },
          glob: { type: 'string', description: 'Glob filter (e.g. "*.js")' },
        },
        required: ['pattern'],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Streaming chat with tool loop
// ---------------------------------------------------------------------------

/**
 * Stream a chat message response via SSE.
 *
 * @param {object} opts
 * @param {string} opts.agentDir     - Project chat data directory
 * @param {string} opts.tbcDbPath    - Orchestrator-controlled TBC database path
 * @param {string} opts.uploadsDir   - Orchestrator-controlled uploads directory
 * @param {string} opts.projectPath  - Project repo path
 * @param {number} opts.chatId       - Chat session ID
 * @param {string} opts.userMessage  - User's message text
 * @param {string} opts.model        - Model name (e.g. 'claude-sonnet-4-6')
 * @param {string} opts.token        - API key/token
 * @param {string} opts.provider     - Provider hint
 * @param {object|null} [opts.customConfig] - Custom provider config
 * @param {object} opts.res          - HTTP response for SSE
 * @param {string} [opts.reasoningEffort] - Optional reasoning effort
 */
export async function streamChatMessage(opts) {
  const { agentDir, tbcDbPath, uploadsDir, projectPath, chatId, userMessage, images = [], model, token, provider, customConfig = null, res, reasoningEffort } = opts;

  // Initialize active stream tracking
  const stream = { text: '', toolCalls: [], clients: new Set() };
  activeStreams.set(chatId, stream);

  // Add the initial client
  stream.clients.add(res);
  res.on('close', () => { stream.clients.delete(res); });

  // Broadcast to all connected clients (supports reconnection)
  const sseWrite = (obj) => {
    const data = `data: ${JSON.stringify(obj)}\n\n`;
    for (const client of stream.clients) {
      try { client.write(data); } catch {}
    }
  };

  // Save user message
  // NOTE: user message is saved by the caller (server.js) before calling this
  // function, so retries on rate-limit fallback don't duplicate it.
  maybeUpdateTitle(agentDir, chatId, userMessage);

  // Ensure worktree
  const worktreePath = ensureWorktree(projectPath);

  // Load history
  const session = getSession(agentDir, chatId);
  if (!session) {
    sseWrite({ type: 'error', content: 'Session not found' });
    sseWrite({ type: 'done' });
    return;
  }

  // Build pi-ai context
  const { piModel } = resolveModel(model, provider);
  const canonicalTools = getChatToolDefinitions();
  const piTools = formatTools(canonicalTools);

    // Load chat skill file
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const skillPath = path.join(ROOT, 'agent', 'chat.md');
  let skillContent = '';
  try {
    skillContent = fs.readFileSync(skillPath, 'utf-8');
    // Strip frontmatter
    skillContent = skillContent.replace(/^---[\s\S]*?---\s*/, '');
  } catch {
    skillContent = 'You are a helpful AI assistant for a software project.';
  }
  const systemPrompt = skillContent.replace(/\{worktree_path\}/g, worktreePath);

  // Convert stored messages to pi-ai format
  // Only include text content from history (not tool calls/results) to avoid
  // tool_use_id mismatches that cause API errors. Tool interactions are
  // ephemeral within a single turn; the text summary is sufficient for context.
  const piMessages = [];
  for (const msg of session.messages) {
    if (msg.role === 'user') {
      piMessages.push(buildUserMessage(msg.content));
    } else if (msg.role === 'assistant') {
      const text = msg.content || '';
      if (text.trim()) {
        piMessages.push({
          role: 'assistant',
          content: [{ type: 'text', text }],
          timestamp: Date.now(),
        });
      }
    }
    // Skip tool_result messages — they're captured in the assistant text summary
  }

  // Add current user message (with images if any)
  const userContent = [];
  if (userMessage) {
    userContent.push({ type: 'text', text: userMessage });
  }
  if (images && images.length > 0) {
    for (const img of images) {
      const imgPath = path.join(uploadsDir, img.filename);
      if (fs.existsSync(imgPath)) {
        const data = fs.readFileSync(imgPath);
        const base64 = data.toString('base64');
        const mimeType = img.mimeType || 'image/jpeg';
        userContent.push({
          type: 'image',
          data: base64,
          mimeType,
        });
      }
    }
  }
  if (userContent.length > 0) {
    piMessages.push({ role: 'user', content: userContent, timestamp: Date.now() });
  }

  // Tool loop — essentially unlimited, safety net only
  const MAX_TOOL_ITERATIONS = 2000;
  let iteration = 0;
  let fullAssistantText = '';
  let allToolCalls = [];

  const piOpts = { apiKey: token };
  if (reasoningEffort) piOpts.reasoning = reasoningEffort;

  try {
    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;
      console.log(`[Chat] Session ${chatId}: iteration ${iteration}, messages: ${piMessages.length}`);

      const context = {
        systemPrompt,
        messages: [...piMessages],
        tools: piTools,
      };

      let assistantText = '';
      let toolCalls = [];
      let finalMessage = null;
      if (provider === 'custom') {
        const response = await callModel(piModel, systemPrompt, context.messages, context.tools, {
          token,
          provider,
          customConfig,
          reasoningEffort,
        });
        assistantText = response.content || '';
        finalMessage = response._piMessage || null;
        for (let i = 0; i < assistantText.length; i += 80) {
          const delta = assistantText.slice(i, i + 80);
          stream.text += delta;
          sseWrite({ type: 'text', content: delta });
        }
        toolCalls = response.toolCalls || [];
        for (const tc of toolCalls) {
          stream.toolCalls.push(tc);
          sseWrite({
            type: 'tool_call',
            id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }
      } else {
        const eventStream = streamSimple(piModel, context, piOpts);
        for await (const event of eventStream) {
          switch (event.type) {
            case 'text_delta':
              assistantText += event.delta;
              stream.text += event.delta;
              sseWrite({ type: 'text', content: event.delta });
              break;

            case 'toolcall_end':
              const tc = {
                id: event.toolCall.id,
                name: event.toolCall.name,
                input: event.toolCall.arguments,
              };
              toolCalls.push(tc);
              stream.toolCalls.push(tc);
              sseWrite({
                type: 'tool_call',
                id: tc.id,
                name: tc.name,
                input: tc.input,
              });
              break;

            case 'done':
              finalMessage = event.message;
              break;

            case 'error':
              const errMsg = event.error?.errorMessage || 'Stream error';
              console.error(`[Chat] Stream error (session ${chatId}): ${errMsg}`);
              if (/rate.limit|usage.limit|quota|429/i.test(errMsg)) {
                throw new Error(errMsg);
              }
              if (fullAssistantText || assistantText) {
                saveMessage(agentDir, chatId, 'assistant',
                  (fullAssistantText + assistantText).trim() + `\n\n⚠️ Error: ${errMsg}`,
                  allToolCalls.length > 0 ? allToolCalls : null,
                  { success: false });
              }
              sseWrite({ type: 'error', content: errMsg });
              sseWrite({ type: 'done' });
              activeStreams.delete(chatId);
              return;
          }
        }
      }

      fullAssistantText += assistantText;
      allToolCalls.push(...toolCalls);

      // Build assistant message for history
      const assistantContent = [];
      if (assistantText) assistantContent.push({ type: 'text', text: assistantText });
      for (const tc of toolCalls) {
        assistantContent.push({ type: 'toolCall', id: tc.id, name: tc.name, arguments: tc.input });
      }
      piMessages.push({
        role: 'assistant',
        content: assistantContent,
        timestamp: Date.now(),
        ...(finalMessage ? { usage: finalMessage.usage, stopReason: finalMessage.stopReason } : {}),
      });

      // If no tool calls, we're done
      if (toolCalls.length === 0) break;

      // Execute tools
      const toolResults = [];
      for (const tc of toolCalls) {
        try {
          const chatEnv = { TBC_DB: tbcDbPath };
          const normalized = await executeToolDetailed(tc.name, tc.input, worktreePath, 0, chatEnv);
          toolResults.push({
            toolCallId: tc.id,
            toolName: tc.name,
            content: normalized.output,
          });
          // Truncate output for SSE display
          const displayOutput = normalized.output.length > 2000 ? normalized.output.slice(0, 2000) + '\n... (truncated)' : normalized.output;
          // Update stream tracking
          const matchingTc = stream.toolCalls.find(t => t.id === tc.id);
          if (matchingTc) {
            matchingTc.output = displayOutput;
            matchingTc.exitCode = normalized.exitCode;
            matchingTc.ok = normalized.ok;
          }
          const storedTc = allToolCalls.find(t => t.id === tc.id);
          if (storedTc) {
            storedTc.output = displayOutput;
            storedTc.exitCode = normalized.exitCode;
            storedTc.ok = normalized.ok;
          }
          sseWrite({
            type: 'tool_result',
            id: tc.id,
            name: tc.name,
            output: displayOutput,
            exitCode: normalized.exitCode,
            ok: normalized.ok,
          });
        } catch (err) {
          const errOutput = `Error: ${err.message}`;
          toolResults.push({
            toolCallId: tc.id,
            toolName: tc.name,
            content: errOutput,
          });
          const matchingTc = stream.toolCalls.find(t => t.id === tc.id);
          if (matchingTc) {
            matchingTc.output = errOutput;
            matchingTc.exitCode = null;
            matchingTc.ok = false;
          }
          const storedTc = allToolCalls.find(t => t.id === tc.id);
          if (storedTc) {
            storedTc.output = errOutput;
            storedTc.exitCode = null;
            storedTc.ok = false;
          }
          sseWrite({
            type: 'tool_result',
            id: tc.id,
            name: tc.name,
            output: errOutput,
            exitCode: null,
            ok: false,
          });
        }
      }

      // Add tool results to history
      const piToolResults = buildToolResultMessages(toolResults);
      piMessages.push(...piToolResults);

      // Save tool result messages
      saveMessage(agentDir, chatId, 'tool_result', JSON.stringify(toolResults));
    }

    // Check if we hit the iteration limit
    if (iteration >= MAX_TOOL_ITERATIONS) {
      console.warn(`[Chat] Session ${chatId}: hit max iterations (${MAX_TOOL_ITERATIONS}), stopping tool loop`);
      const limitMsg = '\n\n*I\'ve done extensive analysis. Let me summarize what I found so far based on the work above.*';
      fullAssistantText += limitMsg;
      sseWrite({ type: 'text', content: limitMsg });
    }

    // Save final assistant message
    saveMessage(agentDir, chatId, 'assistant', fullAssistantText, allToolCalls.length > 0 ? allToolCalls : null, { success: true });

  } catch (err) {
    console.error(`[Chat] Error (session ${chatId}): ${err.message}`);
    // Re-throw rate-limit errors so caller can retry with fallback key
    if (/rate.limit|usage.limit|quota|429/i.test(err.message)) {
      activeStreams.delete(chatId);
      throw err;
    }
    // Save partial progress on error
    if (fullAssistantText) {
      saveMessage(agentDir, chatId, 'assistant',
        fullAssistantText.trim() + `\n\n⚠️ Error: ${err.message}`,
        allToolCalls.length > 0 ? allToolCalls : null,
        { success: false });
    }
    sseWrite({ type: 'error', content: err.message });
  }

  sseWrite({ type: 'done' });
  activeStreams.delete(chatId);
}
