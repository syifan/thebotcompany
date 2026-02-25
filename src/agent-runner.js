/**
 * Agent Runner - Direct Anthropic API integration for TheBotCompany
 *
 * Replaces Claude CLI spawning with direct API calls using @anthropic-ai/sdk.
 * Implements an autonomous agent loop with tool execution.
 */

import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Pricing (per million tokens)
// ---------------------------------------------------------------------------
const MODEL_PRICING = {
  opus:   { input: 15,   output: 75,  cacheRead: 1.5  },
  sonnet: { input: 3,    output: 15,  cacheRead: 0.3  },
  haiku:  { input: 0.80, output: 4,   cacheRead: 0.08 },
};

function getPricing(model) {
  if (model.includes('sonnet')) return MODEL_PRICING.sonnet;
  if (model.includes('haiku'))  return MODEL_PRICING.haiku;
  return MODEL_PRICING.opus;
}

function calculateCost(usage, model) {
  const pricing = getPricing(model);
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  return (
    (inputTokens * pricing.input) +
    (outputTokens * pricing.output) +
    (cacheRead * pricing.cacheRead)
  ) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Glob implementation using Node.js fs
// ---------------------------------------------------------------------------
function globFiles(pattern, cwd) {
  // Use simple recursive glob implementation
  const results = [];
  const base = cwd || process.cwd();

  function matchGlob(filePath, pat) {
    // Convert glob pattern to regex
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
      // Skip hidden dirs and node_modules
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
          regex.lastIndex = 0; // Reset regex state
        }
      }
    } catch {
      // Skip files that can't be read (binary, permissions, etc.)
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
          // Apply glob filter if provided
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
// Tool Definitions (Claude Code canonical casing)
// ---------------------------------------------------------------------------
function getToolDefinitions() {
  return [
    {
      name: 'Bash',
      description: 'Execute a bash command. Returns stdout and stderr.',
      input_schema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash command to execute',
          },
          timeout: {
            type: 'number',
            description: 'Optional timeout in milliseconds (default 120000, max 600000)',
          },
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
          file_path: {
            type: 'string',
            description: 'Absolute path to the file to read',
          },
          offset: {
            type: 'number',
            description: 'Line number to start reading from (1-indexed)',
          },
          limit: {
            type: 'number',
            description: 'Number of lines to read',
          },
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
          file_path: {
            type: 'string',
            description: 'Absolute path to the file to write',
          },
          content: {
            type: 'string',
            description: 'The content to write to the file',
          },
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
          file_path: {
            type: 'string',
            description: 'Absolute path to the file to edit',
          },
          old_string: {
            type: 'string',
            description: 'The exact string to find and replace',
          },
          new_string: {
            type: 'string',
            description: 'The replacement string',
          },
          replace_all: {
            type: 'boolean',
            description: 'Replace all occurrences (default false)',
          },
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
          pattern: {
            type: 'string',
            description: 'Glob pattern to match (e.g. "**/*.js")',
          },
          path: {
            type: 'string',
            description: 'Directory to search in (default: working directory)',
          },
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
          pattern: {
            type: 'string',
            description: 'Regex pattern to search for',
          },
          path: {
            type: 'string',
            description: 'File or directory to search in',
          },
          glob: {
            type: 'string',
            description: 'Glob pattern to filter files (e.g. "*.js")',
          },
          case_insensitive: {
            type: 'boolean',
            description: 'Case insensitive search',
          },
        },
        required: ['pattern'],
      },
    },
  ];
}


// ---------------------------------------------------------------------------
// Tool Execution
// ---------------------------------------------------------------------------
function executeBash(input, cwd) {
  const timeout = Math.min(input.timeout || 120000, 600000);
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', input.command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
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
      // Truncate very long output
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
  if (!path.isAbsolute(filePath)) {
    filePath = path.join(cwd, filePath);
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const offset = (input.offset || 1) - 1; // Convert to 0-indexed
    const limit = input.limit || lines.length;
    const slice = lines.slice(offset, offset + limit);

    return slice
      .map((line, i) => `${String(offset + i + 1).padStart(6)}\t${line}`)
      .join('\n');
  } catch (err) {
    return `Error reading file: ${err.message}`;
  }
}

function executeWrite(input, cwd) {
  let filePath = input.file_path;
  if (!path.isAbsolute(filePath)) {
    filePath = path.join(cwd, filePath);
  }

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, input.content);
    return `Successfully wrote to ${filePath}`;
  } catch (err) {
    return `Error writing file: ${err.message}`;
  }
}

function executeEdit(input, cwd) {
  let filePath = input.file_path;
  if (!path.isAbsolute(filePath)) {
    filePath = path.join(cwd, filePath);
  }

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
      // Check uniqueness
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
    // Limit output
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

async function executeTool(toolName, toolInput, cwd) {
  switch (toolName) {
    case 'Bash':  return await executeBash(toolInput, cwd);
    case 'Read':  return executeRead(toolInput, cwd);
    case 'Write': return executeWrite(toolInput, cwd);
    case 'Edit':  return executeEdit(toolInput, cwd);
    case 'Glob':  return executeGlob(toolInput, cwd);
    case 'Grep':  return executeGrep(toolInput, cwd);
    default:      return `Unknown tool: ${toolName}`;
  }
}


// ---------------------------------------------------------------------------
// Main Agent Runner
// ---------------------------------------------------------------------------

/**
 * Run an agent using the Anthropic API directly.
 *
 * @param {Object} opts
 * @param {string} opts.prompt       - The full system prompt / skill content
 * @param {string} opts.model        - Model name (e.g. 'claude-opus-4-6')
 * @param {string} opts.token        - Auth token (OAuth or API key)
 * @param {string} opts.cwd          - Working directory for tool execution
 * @param {number} opts.timeoutMs    - Max runtime in milliseconds (0 = unlimited)
 * @param {Object} opts.env          - Environment variables for Bash commands
 * @param {function} opts.log        - Logging function (optional)
 * @returns {Promise<Object>}        - { success, resultText, usage, cost, durationMs }
 */
export async function runAgentWithAPI(opts) {
  const {
    prompt,
    model = 'claude-opus-4-6',
    token,
    cwd,
    timeoutMs = 0,
    env = {},
    log = () => {},
  } = opts;

  const startTime = Date.now();
  const isOAuth = token && token.startsWith('sk-ant-oat');

  // Configure client
  const clientOpts = {};
  if (isOAuth) {
    clientOpts.apiKey = null;
    clientOpts.authToken = token;
    clientOpts.defaultHeaders = {
      'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14',
      'user-agent': 'claude-cli/2.1.2 (external, cli)',
      'x-app': 'cli',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  } else if (token) {
    clientOpts.apiKey = token;
  }

  const client = new Anthropic(clientOpts);

  // Build system prompt
  let systemPrompt = prompt;
  if (isOAuth) {
    systemPrompt = 'You are Claude Code, Anthropic\'s official CLI for Claude.\n\n' + systemPrompt;
  }

  // Set up env for Bash commands
  const bashEnv = { ...process.env, ...env };

  // Patch cwd into bash environment
  const originalCwd = process.cwd();

  const tools = getToolDefinitions();

  // Accumulate usage across all API calls
  const totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };

  // Initial messages
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Begin your work now. Follow the instructions in the system prompt.',
          cache_control: { type: 'ephemeral' },
        },
      ],
    },
  ];

  const MAX_ITERATIONS = 200;
  let lastResultText = '';

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Check timeout
    if (timeoutMs > 0 && (Date.now() - startTime) >= timeoutMs) {
      log(`Agent timeout after ${iteration} iterations`);
      return {
        success: false,
        resultText: lastResultText || 'Agent timed out',
        usage: totalUsage,
        cost: calculateCost(totalUsage, model),
        durationMs: Date.now() - startTime,
        timedOut: true,
      };
    }

    // Build API request
    const requestParams = {
      model,
      max_tokens: 16384,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools,
      messages,
    };

    // Enable extended thinking for opus models
    if (model.includes('opus')) {
      requestParams.temperature = 1; // Required for extended thinking
      requestParams.thinking = {
        type: 'enabled',
        budget_tokens: 10000,
      };
    }

    let response;
    try {
      response = await client.messages.create(requestParams);
    } catch (err) {
      log(`API error: ${err.message}`);
      return {
        success: false,
        resultText: `API error: ${err.message}`,
        usage: totalUsage,
        cost: calculateCost(totalUsage, model),
        durationMs: Date.now() - startTime,
      };
    }

    // Accumulate usage
    if (response.usage) {
      totalUsage.input_tokens += response.usage.input_tokens || 0;
      totalUsage.output_tokens += response.usage.output_tokens || 0;
      totalUsage.cache_read_input_tokens += response.usage.cache_read_input_tokens || 0;
    }

    // Extract text from response
    const textBlocks = response.content.filter(b => b.type === 'text');
    if (textBlocks.length > 0) {
      lastResultText = textBlocks.map(b => b.text).join('\n');
    }

    // Check stop reason
    if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
      return {
        success: true,
        resultText: lastResultText,
        usage: totalUsage,
        cost: calculateCost(totalUsage, model),
        durationMs: Date.now() - startTime,
      };
    }

    // Handle tool use
    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

      // Add assistant's response to messages
      messages.push({ role: 'assistant', content: response.content });

      // Execute tools and collect results
      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        log(`Tool: ${toolUse.name}${toolUse.name === 'Bash' ? ` → ${(toolUse.input.command || '').slice(0, 100)}` : ''}`);

        // Set up environment for Bash tool
        let toolCwd = cwd;
        const toolEnv = { ...bashEnv };

        const result = await executeTool(toolUse.name, toolUse.input, toolCwd);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      // Add tool results to messages, with cache_control on the last one
      const userMessage = { role: 'user', content: toolResults };
      // Add cache_control to the last tool result
      if (toolResults.length > 0) {
        toolResults[toolResults.length - 1].cache_control = { type: 'ephemeral' };
      }
      messages.push(userMessage);
    } else {
      // Unknown stop reason, bail
      log(`Unexpected stop reason: ${response.stop_reason}`);
      return {
        success: true,
        resultText: lastResultText,
        usage: totalUsage,
        cost: calculateCost(totalUsage, model),
        durationMs: Date.now() - startTime,
      };
    }
  }

  // Exceeded max iterations
  return {
    success: false,
    resultText: lastResultText || 'Agent exceeded maximum iterations',
    usage: totalUsage,
    cost: calculateCost(totalUsage, model),
    durationMs: Date.now() - startTime,
  };
}
