/**
 * Chat Engine — interactive chat sessions with AI agent per project.
 * 
 * Manages chat sessions in SQLite, streams LLM responses via SSE,
 * and executes tools in a git worktree separate from agent workspace.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { streamSimple } from '@mariozechner/pi-ai';
import {
  resolveModel,
  formatTools,
  buildUserMessage,
  buildToolResultMessages,
} from './providers/index.js';
import { executeTool } from './agent-runner.js';

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
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT DEFAULT '',
      tool_calls TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
  `);
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

export function createSession(agentDir, title) {
  const db = getChatDb(agentDir);
  try {
    const result = db.prepare('INSERT INTO chat_sessions (title) VALUES (?)').run(title || 'New Chat');
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

function saveMessage(agentDir, sessionId, role, content, toolCalls = null) {
  const db = getChatDb(agentDir);
  try {
    db.prepare(
      'INSERT INTO chat_messages (session_id, role, content, tool_calls) VALUES (?, ?, ?, ?)'
    ).run(sessionId, role, content, toolCalls ? JSON.stringify(toolCalls) : null);
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
 * @param {string} opts.agentDir     - Project's workspace/agent directory
 * @param {string} opts.projectPath  - Project repo path
 * @param {number} opts.chatId       - Chat session ID
 * @param {string} opts.userMessage  - User's message text
 * @param {string} opts.model        - Model name (e.g. 'claude-sonnet-4-6')
 * @param {string} opts.token        - API key/token
 * @param {string} opts.provider     - Provider hint
 * @param {object} opts.res          - HTTP response for SSE
 * @param {string} [opts.reasoningEffort] - Optional reasoning effort
 */
export async function streamChatMessage(opts) {
  const { agentDir, projectPath, chatId, userMessage, model, token, provider, res, reasoningEffort } = opts;

  // Save user message
  saveMessage(agentDir, chatId, 'user', userMessage);
  maybeUpdateTitle(agentDir, chatId, userMessage);

  // Ensure worktree
  const worktreePath = ensureWorktree(projectPath);

  // Load history
  const session = getSession(agentDir, chatId);
  if (!session) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: 'Session not found' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    return;
  }

  // Build pi-ai context
  const { piModel } = resolveModel(model);
  const canonicalTools = getChatToolDefinitions();
  const piTools = formatTools(canonicalTools);

  const systemPrompt = `You are a helpful AI assistant for a software project. You can read, edit, and run commands in the project's codebase.

Project directory: ${worktreePath}

Be concise and helpful. When asked about code, use the tools to look things up rather than guessing.`;

  // Convert stored messages to pi-ai format
  const piMessages = [];
  for (const msg of session.messages) {
    if (msg.role === 'user') {
      piMessages.push(buildUserMessage(msg.content));
    } else if (msg.role === 'assistant') {
      // Reconstruct pi-ai assistant message
      const content = [];
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      if (msg.tool_calls) {
        const calls = JSON.parse(msg.tool_calls);
        for (const tc of calls) {
          content.push({
            type: 'toolCall',
            id: tc.id,
            name: tc.name,
            arguments: tc.input,
          });
        }
      }
      piMessages.push({
        role: 'assistant',
        content,
        timestamp: Date.now(),
      });
    } else if (msg.role === 'tool_result') {
      // Tool results stored as JSON
      const results = JSON.parse(msg.content);
      piMessages.push(...buildToolResultMessages(results));
    }
  }

  // Tool loop — max 10 iterations
  const MAX_TOOL_ITERATIONS = 10;
  let iteration = 0;
  let fullAssistantText = '';
  let allToolCalls = [];

  const piOpts = { apiKey: token };
  if (reasoningEffort) piOpts.reasoning = reasoningEffort;

  try {
    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;

      const context = {
        systemPrompt,
        messages: [...piMessages],
        tools: piTools,
      };

      // Stream the response
      const eventStream = streamSimple(piModel, context, piOpts);
      let assistantText = '';
      let toolCalls = [];
      let finalMessage = null;

      for await (const event of eventStream) {
        switch (event.type) {
          case 'text_delta':
            assistantText += event.delta;
            res.write(`data: ${JSON.stringify({ type: 'text', content: event.delta })}\n\n`);
            break;

          case 'toolcall_end':
            toolCalls.push({
              id: event.toolCall.id,
              name: event.toolCall.name,
              input: event.toolCall.arguments,
            });
            res.write(`data: ${JSON.stringify({
              type: 'tool_call',
              id: event.toolCall.id,
              name: event.toolCall.name,
              input: event.toolCall.arguments,
            })}\n\n`);
            break;

          case 'done':
            finalMessage = event.message;
            break;

          case 'error':
            const errMsg = event.error?.errorMessage || 'Stream error';
            res.write(`data: ${JSON.stringify({ type: 'error', content: errMsg })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            return;
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
          const result = await executeTool(tc.name, tc.input, worktreePath);
          const output = typeof result === 'string' ? result : JSON.stringify(result);
          toolResults.push({
            toolCallId: tc.id,
            toolName: tc.name,
            content: output,
          });
          // Truncate output for SSE display
          const displayOutput = output.length > 2000 ? output.slice(0, 2000) + '\n... (truncated)' : output;
          res.write(`data: ${JSON.stringify({
            type: 'tool_result',
            id: tc.id,
            name: tc.name,
            output: displayOutput,
          })}\n\n`);
        } catch (err) {
          const errOutput = `Error: ${err.message}`;
          toolResults.push({
            toolCallId: tc.id,
            toolName: tc.name,
            content: errOutput,
          });
          res.write(`data: ${JSON.stringify({
            type: 'tool_result',
            id: tc.id,
            name: tc.name,
            output: errOutput,
          })}\n\n`);
        }
      }

      // Add tool results to history
      const piToolResults = buildToolResultMessages(toolResults);
      piMessages.push(...piToolResults);

      // Save tool result messages
      saveMessage(agentDir, chatId, 'tool_result', JSON.stringify(toolResults));
    }

    // Save final assistant message
    saveMessage(agentDir, chatId, 'assistant', fullAssistantText, allToolCalls.length > 0 ? allToolCalls : null);

  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
  }

  res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
}
