/**
 * Agent Runner - Multi-provider agent loop for TheBotCompany
 *
 * Supports Anthropic (Claude) and OpenAI models via a provider abstraction.
 * Tools: Bash, Read, Write, Edit, Glob, Grep — all implemented locally.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getProvider } from './providers/index.js';

// ---------------------------------------------------------------------------
// Glob implementation using Node.js fs
// ---------------------------------------------------------------------------
function globFiles(pattern, cwd) {
  const results = [];
  const base = cwd || process.cwd();

  function matchGlob(filePath, pat) {
    const regexStr = pat
      .replace(/\*\*/g, '<<<GLOBSTAR>>>')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/<<<GLOBSTAR>>>/g, '.*')
      .replace(/\./g, '\\.');
    return new RegExp(`^${regexStr}$`).test(filePath);
  }

  function walk(dir, relDir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else {
        if (matchGlob(relPath, pattern)) {
          results.push(relPath);
        }
      }
    }
  }

  walk(base, '');
  return results.sort();
}

// ---------------------------------------------------------------------------
// Grep implementation
// ---------------------------------------------------------------------------
function grepFiles(pattern, searchPath, options = {}) {
  const results = [];
  const isDir = fs.statSync(searchPath).isDirectory();
  const regex = new RegExp(pattern, options.caseInsensitive ? 'gi' : 'g');

  function searchFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push({
            file: filePath,
            line: i + 1,
            content: lines[i],
          });
          regex.lastIndex = 0;
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  if (!isDir) {
    searchFile(searchPath);
  } else {
    function walk(dir) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else {
          if (options.glob) {
            const ext = path.extname(entry.name);
            const globPattern = options.glob.replace('*.', '');
            if (ext !== `.${globPattern}` && options.glob !== '*') continue;
          }
          searchFile(fullPath);
        }
      }
    }
    walk(searchPath);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Tool Definitions (canonical format — Anthropic input_schema style)
// ---------------------------------------------------------------------------
function getToolDefinitions() {
  return [
    {
      name: 'Bash',
      description: 'Execute a bash command. Returns stdout and stderr.',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' },
          timeout: { type: 'number', description: 'Optional timeout in milliseconds (default 120000, max 600000)' },
        },
        required: ['command'],
      },
    },
    {
      name: 'Read',
      description: 'Read a file from the filesystem. Returns file contents with line numbers.',
      input_schema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path to the file to read' },
          offset: { type: 'number', description: 'Line number to start reading from (1-indexed)' },
          limit: { type: 'number', description: 'Number of lines to read' },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'Write',
      description: 'Write content to a file, creating it if necessary.',
      input_schema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path to the file to write' },
          content: { type: 'string', description: 'The content to write to the file' },
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
          file_path: { type: 'string', description: 'Absolute path to the file to edit' },
          old_string: { type: 'string', description: 'The exact string to find and replace' },
          new_string: { type: 'string', description: 'The replacement string' },
          replace_all: { type: 'boolean', description: 'Replace all occurrences (default false)' },
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
          pattern: { type: 'string', description: 'Glob pattern to match (e.g. "**/*.js")' },
          path: { type: 'string', description: 'Directory to search in (default: working directory)' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'Grep',
      description: 'Search file contents using regex patterns.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          path: { type: 'string', description: 'File or directory to search in' },
          glob: { type: 'string', description: 'Glob pattern to filter files (e.g. "*.js")' },
          case_insensitive: { type: 'boolean', description: 'Case insensitive search' },
        },
        required: ['pattern'],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Tool Execution
// ---------------------------------------------------------------------------
function executeBash(input, cwd, remainingMs = 0, bashEnv = null) {
  let timeout = Math.min(input.timeout || 120000, 600000);
  if (remainingMs > 0) {
    timeout = Math.min(timeout, remainingMs);
  }
  // Strip any TBC_DB overrides — agents must use the injected env value
  let command = input.command;
  command = command.replace(/\bexport\s+TBC_DB=[^\s;|&]*/g, 'true');
  command = command.replace(/\bTBC_DB=[^\s;|&]*/g, 'true');
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      ...(bashEnv ? { env: bashEnv } : {}),
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 5000);
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      let result = '';
      if (stdout) result += stdout;
      if (stderr) result += (result ? '\n' : '') + stderr;
      if (code !== 0 && code !== null) {
        result += `\nExit code: ${code}`;
      }
      if (result.length > 100000) {
        result = result.slice(0, 50000) + '\n\n... (output truncated) ...\n\n' + result.slice(-50000);
      }
      resolve(result || '(no output)');
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve(`Error executing command: ${err.message}`);
    });
  });
}

function executeRead(input, cwd) {
  let filePath = input.file_path;
  if (!path.isAbsolute(filePath)) filePath = path.join(cwd, filePath);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const offset = (input.offset || 1) - 1;
    const limit = input.limit || lines.length;
    const slice = lines.slice(offset, offset + limit);
    return slice.map((line, i) => `${String(offset + i + 1).padStart(6)}\t${line}`).join('\n');
  } catch (err) {
    return `Error reading file: ${err.message}`;
  }
}

function executeWrite(input, cwd) {
  let filePath = input.file_path;
  if (!path.isAbsolute(filePath)) filePath = path.join(cwd, filePath);
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, input.content);
    return `Successfully wrote to ${filePath}`;
  } catch (err) {
    return `Error writing file: ${err.message}`;
  }
}

function executeEdit(input, cwd) {
  let filePath = input.file_path;
  if (!path.isAbsolute(filePath)) filePath = path.join(cwd, filePath);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const oldStr = input.old_string;
    const newStr = input.new_string;
    if (!content.includes(oldStr)) {
      return `Error: old_string not found in file. Make sure it matches exactly.`;
    }
    let updated;
    if (input.replace_all) {
      updated = content.replaceAll(oldStr, newStr);
    } else {
      const idx = content.indexOf(oldStr);
      if (content.indexOf(oldStr, idx + 1) !== -1) {
        return `Error: old_string is not unique in the file. Provide more context or use replace_all.`;
      }
      updated = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
    }
    fs.writeFileSync(filePath, updated);
    return `Successfully edited ${filePath}`;
  } catch (err) {
    return `Error editing file: ${err.message}`;
  }
}

function executeGlob(input, cwd) {
  const searchPath = input.path || cwd;
  const resolvedPath = path.isAbsolute(searchPath) ? searchPath : path.join(cwd, searchPath);
  try {
    const files = globFiles(input.pattern, resolvedPath);
    if (files.length === 0) return 'No files matched the pattern.';
    return files.join('\n');
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

function executeGrep(input, cwd) {
  const searchPath = input.path || cwd;
  const resolvedPath = path.isAbsolute(searchPath) ? searchPath : path.join(cwd, searchPath);
  try {
    const matches = grepFiles(input.pattern, resolvedPath, {
      caseInsensitive: input.case_insensitive,
      glob: input.glob,
    });
    if (matches.length === 0) return 'No matches found.';
    const limited = matches.slice(0, 200);
    const output = limited.map(m => `${m.file}:${m.line}: ${m.content}`).join('\n');
    if (matches.length > 200) {
      return output + `\n\n... (${matches.length - 200} more matches)`;
    }
    return output;
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

async function executeTool(toolName, toolInput, cwd, remainingMs = 0, bashEnv = null) {
  switch (toolName) {
    case 'Bash':  return await executeBash(toolInput, cwd, remainingMs, bashEnv);
    case 'Read':  return executeRead(toolInput, cwd);
    case 'Write': return executeWrite(toolInput, cwd);
    case 'Edit':  return executeEdit(toolInput, cwd);
    case 'Glob':  return executeGlob(toolInput, cwd);
    case 'Grep':  return executeGrep(toolInput, cwd);
    default:      return `Unknown tool: ${toolName}`;
  }
}

// ---------------------------------------------------------------------------
// Main Agent Runner (provider-agnostic)
// ---------------------------------------------------------------------------

/**
 * Run an agent using the configured provider's API.
 *
 * @param {Object} opts
 * @param {string} opts.prompt       - The full system prompt / skill content
 * @param {string} opts.model        - Model name (e.g. 'claude-opus-4-6', 'openai/gpt-4.1')
 * @param {string} opts.token        - Auth token (OAuth, API key, or OpenAI key)
 * @param {string} opts.cwd          - Working directory for tool execution
 * @param {number} opts.timeoutMs    - Max runtime in milliseconds (0 = unlimited)
 * @param {Object} opts.env          - Environment variables for Bash commands
 * @param {function} opts.log        - Logging function (optional)
 * @returns {Promise<Object>}        - { success, resultText, usage, cost, durationMs }
 */
export async function runAgentWithAPI(opts) {
  const {
    prompt,
    model: rawModel = 'claude-opus-4-6',
    token,
    reasoningEffort,
    cwd,
    timeoutMs = 0,
    env = {},
    log = () => {},
  } = opts;

  const startTime = Date.now();
  const { provider, model } = getProvider(rawModel);
  const isOAuth = token && token.startsWith('sk-ant-oat');

  // Create provider client
  const client = provider.createClient({ token, isOAuth });

  // Format tools for this provider
  const canonicalTools = getToolDefinitions();
  const tools = provider.formatTools(canonicalTools);

  // Set up env for Bash commands
  const bashEnv = { ...process.env, ...env };

  // Accumulated usage (normalized)
  const totalUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

  // Hard timeout via AbortController
  let aborted = false;
  const abortController = new AbortController();
  let hardTimeoutTimer;
  if (timeoutMs > 0) {
    hardTimeoutTimer = setTimeout(() => {
      aborted = true;
      abortController.abort();
      log(`⏰ Hard timeout after ${Math.floor((Date.now() - startTime) / 60000)}m`);
    }, timeoutMs);
  }

  // Helper to build result object
  function makeResult(success, resultText, extra = {}) {
    return {
      success,
      resultText,
      usage: totalUsage,
      cost: provider.calculateCost(totalUsage, model),
      durationMs: Date.now() - startTime,
      ...extra,
    };
  }

  // Initial messages (provider-agnostic format, converted in buildRequest)
  const messages = [
    {
      role: 'user',
      content: [{ type: 'text', text: 'Begin your work now. Follow the instructions in the system prompt.' }],
    },
  ];

  const MAX_ITERATIONS = 200;
  let lastResultText = '';
  let lastInputTokens = 0;

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      if (aborted || (timeoutMs > 0 && (Date.now() - startTime) >= timeoutMs)) {
        log(`Agent timeout after ${iteration} iterations`);
        return makeResult(false, lastResultText || 'Agent timed out', { timedOut: true });
      }

      // Auto-compact conversation history when approaching context limit
      // Use lastInputTokens (from most recent API call) not cumulative total
      const TOKEN_LIMIT = 160000; // leave headroom below 200K
      if (lastInputTokens > TOKEN_LIMIT && messages.length > 5) {
        let keep = Math.max(3, Math.floor(messages.length * 0.4));
        // Ensure we don't split assistant/tool-result pairs — the kept portion
        // must start with an assistant message (not a tool result)
        let splitIdx = messages.length - keep;
        while (splitIdx < messages.length - 1) {
          const msg = messages[splitIdx];
          const hasToolResults = Array.isArray(msg.content) &&
            msg.content[0]?.type && (msg.content[0].type === 'tool_result' || msg.content[0].type === 'function_call_output');
          if (msg.role === 'user' && hasToolResults) {
            splitIdx--; // include the preceding assistant message
          } else {
            break;
          }
        }
        if (splitIdx < 1) splitIdx = 1;
        const toCompact = messages.splice(1, splitIdx - 1);
        log(`Compacting ${toCompact.length} messages (last request: ${lastInputTokens} tokens)...`);

        // Build a text representation of old messages for summarization
        const compactText = toCompact.map((m, i) => {
          const role = m.role || 'unknown';
          let text = '';
          if (Array.isArray(m.content)) {
            text = m.content.map(c => {
              if (c.type === 'text') return c.text;
              if (c.type === 'tool_use') return `[Tool call: ${c.name}(${JSON.stringify(c.input).slice(0, 200)})]`;
              if (c.type === 'tool_result') return `[Tool result: ${(typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 500)}]`;
              return `[${c.type}]`;
            }).join('\n');
          } else if (typeof m.content === 'string') {
            text = m.content;
          }
          return `[${role}] ${text.slice(0, 1000)}`;
        }).join('\n---\n');

        // Use a cheap/fast model for summarization
        try {
          const summaryParams = provider.buildRequest({
            model: model.includes('opus') ? model.replace('opus', 'sonnet') : model,
            systemPrompt: 'Summarize this agent conversation history concisely. Focus on: what tasks were attempted, what succeeded/failed, what files were modified, current state, and any important decisions. Be specific about file paths, issue numbers, and error messages. Output only the summary.',
            messages: [{
              role: 'user',
              content: [{ type: 'text', text: compactText.slice(0, 80000) }],
            }],
            tools: [],
            isOAuth,
          });

          const summaryResponse = await provider.callAPI(client, summaryParams, abortController.signal);
          totalUsage.inputTokens += summaryResponse.usage.inputTokens;
          totalUsage.outputTokens += summaryResponse.usage.outputTokens;
          totalUsage.cacheReadTokens += summaryResponse.usage.cacheReadTokens || 0;

          const summary = summaryResponse.content || '(compaction failed — earlier context was dropped)';
          log(`Compacted ${toCompact.length} messages into summary (${summary.length} chars)`);

          messages.splice(1, 0, {
            role: 'user',
            content: [{ type: 'text', text: `[System: The conversation history was auto-compacted to stay within context limits. Here is a summary of the earlier work:]\n\n${summary}` }],
          });
        } catch (compactErr) {
          log(`Compaction summarization failed: ${compactErr.message}, falling back to trim`);
          messages.splice(1, 0, {
            role: 'user',
            content: [{ type: 'text', text: `[System: ${toCompact.length} earlier messages were trimmed to stay within context limits. Continue your work based on what you can see.]` }],
          });
        }
      }

      // Provider-specific cache hints
      provider.applyCacheHints(messages);

      // Build request
      const params = provider.buildRequest({
        model, systemPrompt: prompt, messages, tools, isOAuth, reasoningEffort,
      });

      // Call API with retry for transient errors (429, 503)
      let response;
      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          response = await provider.callAPI(client, params, abortController.signal);
          break; // success
        } catch (err) {
          if (aborted || err.name === 'AbortError' || abortController.signal.aborted) {
            log(`Agent timeout during API call (aborted)`);
            return makeResult(false, lastResultText || 'Agent timed out', { timedOut: true });
          }
          const status = err.status || err.code || 0;
          const isRetryable = status === 429 || status === 503 || /rate.limit|overloaded|unavailable|quota/i.test(err.message);
          if (isRetryable && attempt < MAX_RETRIES) {
            // Parse retry-after from error message or use exponential backoff
            const retryMatch = err.message.match(/retry in ([\d.]+)s/i);
            const delaySec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : Math.pow(2, attempt + 1) * 5;
            const cappedDelay = Math.min(delaySec, 120);
            log(`API ${status} error, retrying in ${cappedDelay}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
            await new Promise(r => setTimeout(r, cappedDelay * 1000));
            if (aborted) {
              return makeResult(false, lastResultText || 'Agent timed out', { timedOut: true });
            }
            continue;
          }
          log(`API error: ${err.message}`);
          return makeResult(false, `API error: ${err.message}`);
        }
      }

      if (aborted) {
        totalUsage.inputTokens += response.usage.inputTokens;
        totalUsage.outputTokens += response.usage.outputTokens;
        totalUsage.cacheReadTokens += response.usage.cacheReadTokens || 0;
        log(`Agent timeout after API call (iteration ${iteration})`);
        return makeResult(false, lastResultText || 'Agent timed out', { timedOut: true });
      }

      // Accumulate usage
      lastInputTokens = response.usage.inputTokens;
      totalUsage.inputTokens += response.usage.inputTokens;
      totalUsage.outputTokens += response.usage.outputTokens;
      totalUsage.cacheReadTokens += response.usage.cacheReadTokens || 0;

      // Extract text
      if (response.content) {
        lastResultText = response.content;
      }

      // Check stop reason
      if (response.stopReason === 'end_turn' || response.stopReason === 'max_tokens') {
        return makeResult(true, lastResultText);
      }

      // Handle tool use
      if (response.stopReason === 'tool_use') {
        // Add assistant message to history
        messages.push(provider.buildAssistantMessage(response));

        // Execute tools
        const toolResults = [];
        for (const tc of response.toolCalls) {
          if (aborted) break;

          log(`Tool: ${tc.name}${tc.name === 'Bash' ? ` → ${(tc.input.command || '').slice(0, 300)}` : ''}`);

          const remainingMs = timeoutMs > 0 ? Math.max(0, timeoutMs - (Date.now() - startTime)) : 0;
          const result = await executeTool(tc.name, tc.input, cwd, remainingMs, bashEnv);
          toolResults.push({ toolCallId: tc.id, content: result });
        }

        if (aborted) {
          log(`Agent timeout during tool execution (iteration ${iteration})`);
          return makeResult(false, lastResultText || 'Agent timed out', { timedOut: true });
        }

        // Add tool results to messages
        messages.push(provider.buildToolResultMessage(toolResults));
      } else {
        log(`Unexpected stop reason: ${response.stopReason}`);
        return makeResult(true, lastResultText);
      }
    }

    return makeResult(false, lastResultText || 'Agent exceeded maximum iterations');
  } finally {
    if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
  }
}
