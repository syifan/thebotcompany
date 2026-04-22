/**
 * Agent Runner - Multi-provider agent loop for TheBotCompany
 *
 * Supports Anthropic (Claude) and OpenAI models via a provider abstraction.
 * Tools: Bash, Read, Write, Edit, Glob, Grep — all implemented locally.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveModel,
  formatTools,
  callModel,
  buildAssistantMessage,
  buildToolResultMessages,
  buildUserMessage,
  calculateCost,
} from './providers/index.js';

// ---------------------------------------------------------------------------
// Parse retry cooldown from error messages
// Supports: "~162 min", "30s", "2 hours", "retry in 5m", "Retry-After: 120"
// ---------------------------------------------------------------------------

function parseRetryCooldown(message) {
  if (!message) return 5 * 60_000; // default 5 min

  // "~162 min" or "162 minutes"
  const minMatch = message.match(/~?(\d+)\s*min/i);
  if (minMatch) return parseInt(minMatch[1]) * 60_000;

  // "2 hours" or "2h"
  const hourMatch = message.match(/(\d+)\s*h(?:ours?)?/i);
  if (hourMatch) return parseInt(hourMatch[1]) * 3600_000;

  // "30s" or "30 seconds" or "retry in 30s"
  const secMatch = message.match(/(\d+)\s*s(?:ec(?:onds?)?)?/i);
  if (secMatch) return parseInt(secMatch[1]) * 1000;

  // Retry-After header value (seconds)
  const retryAfter = message.match(/retry.after:\s*(\d+)/i);
  if (retryAfter) return parseInt(retryAfter[1]) * 1000;

  return 5 * 60_000; // default 5 min
}

// ---------------------------------------------------------------------------
// Git/gh sandbox: block unauthorized repo operations
// ---------------------------------------------------------------------------
function checkGitCommand(command, allowedRepo) {
  // --- git checks ---
  const hasGit = /(?:^|[;&|`\s])git\s/.test(command) || command.trimStart().startsWith('git ');
  if (hasGit) {
    // Block: git clone
    if (/(?:^|[;&|`\s])git\s+clone\b/.test(command)) {
      return 'Blocked: git clone is not allowed. Agents may only operate within the current project repo.';
    }

    // Block: git remote add / set-url
    if (/(?:^|[;&|`\s])git\s+remote\s+(add|set-url)\b/.test(command)) {
      return 'Blocked: modifying git remotes is not allowed.';
    }

    // Block: git push to a remote other than origin
    const pushMatch = command.match(/(?:^|[;&|`\s])git\s+push\s+(.*)/);
    if (pushMatch) {
      const args = pushMatch[1].trim().split(/\s+/).filter(a => !a.startsWith('-'));
      if (args.length > 0 && args[0] !== 'origin') {
        return `Blocked: git push to remote "${args[0]}" is not allowed. Only "origin" is permitted.`;
      }
    }
  }

  // --- gh CLI checks ---
  const hasGh = /(?:^|[;&|`\s])gh\s/.test(command) || command.trimStart().startsWith('gh ');
  if (hasGh) {
    if (/(?:^|[;&|`\s])gh\s+pr\s+create\b/.test(command)) {
      return 'Blocked: gh pr create is not allowed. Create a local TBC PR instead with tbc-db pr-create.';
    }

    // Block: gh operations targeting a different repo
    const ghRepoMatch = command.match(/(?:^|[;&|`\s])gh\s+.*--repo\s+([^\s]+)/);
    if (ghRepoMatch) {
      const targetRepo = ghRepoMatch[1].replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
      if (allowedRepo && targetRepo !== allowedRepo) {
        return `Blocked: gh operation targeting "${targetRepo}" is not allowed. Only "${allowedRepo}" is permitted.`;
      }
    }

    // Block: gh repo clone / gh repo create / gh repo fork
    if (/(?:^|[;&|`\s])gh\s+repo\s+(clone|create|fork)\b/.test(command)) {
      return 'Blocked: gh repo clone/create/fork is not allowed.';
    }
  }

  return null; // allowed
}

function checkSensitiveDbAccess(command) {
  if (!command) return null;
  if (/\b(?:export\s+)?TBC_DB\s*=/.test(command)) {
    return 'Blocked: overriding TBC_DB is not allowed. Use the orchestrator-provided project database only.';
  }
  if (/project\.db\b/.test(command) || /\$\{?TBC_DB\}?/.test(command) || /process\.env\.TBC_DB|os\.environ\[['"]TBC_DB['"]\]/.test(command)) {
    return 'Blocked: raw project database access is not allowed. Use tbc-db CLI for project database operations.';
  }
  return null;
}

function checkSensitiveLogAccess(command, allowedPaths = null) {
  if (!command || !allowedPaths?.denied?.length) return null;
  const denied = allowedPaths.denied.map(p => String(p || '').replace(/\\/g, '/'));
  const logDenied = denied.some(p => p.endsWith('/orchestrator.log') || p.endsWith('/server.log') || p.includes('/.thebotcompany/logs/'));
  if (!logDenied) return null;
  if (/(?:^|[;&|`\s])tbc\s+logs\b/i.test(command)) {
    return 'Blocked: system log access is not allowed.';
  }
  if (/orchestrator\.log\b|server\.log\b|\.thebotcompany\/logs\//i.test(command)) {
    return 'Blocked: system log access is not allowed.';
  }
  return null;
}

function extractTbcDbCommand(command) {
  if (!command || !/(?:^|[;&|`\s])tbc-db\b/.test(` ${command}`)) return null;
  const trimmed = command.trim();
  const match = trimmed.match(/(?:^|.*?[;&|`]\s*)tbc-db\s+(.+)$/);
  const args = (match ? match[1] : trimmed.replace(/^tbc-db\s+/, '')).trim();
  if (!args) return { kind: 'unknown' };

  const issueFlagMatch = args.match(/--issue\s+(\d+)/);
  const positionalIssueMatch = args.match(/^(?:issue-view|issue-edit|issue-close|comments)\s+(\d+)\b/);
  const issueId = issueFlagMatch?.[1] || positionalIssueMatch?.[1] || null;
  const prFlagMatch = args.match(/--pr\s+(\d+)/);
  const positionalPrMatch = args.match(/^(?:pr-view|pr-edit)\s+(\d+)\b/);
  const prId = prFlagMatch?.[1] || positionalPrMatch?.[1] || null;
  const actorMatch = args.match(/--(?:actor|creator|author|editor|closer)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  const actor = actorMatch ? (actorMatch[1] || actorMatch[2] || actorMatch[3]) : null;

  if (/^issue-create\b/.test(args)) return { kind: 'issue-create', actor };
  if (/^issue-list\b/.test(args)) return { kind: 'issue-list' };
  if (/^issue-view\b/.test(args)) return { kind: 'issue-view', issueId };
  if (/^comments\b/.test(args)) return { kind: 'comments', issueId };
  if (/^comment\b/.test(args)) return { kind: 'comment', issueId, actor };
  if (/^issue-edit\b/.test(args)) return { kind: 'issue-edit', issueId, actor };
  if (/^issue-close\b/.test(args)) return { kind: 'issue-close', issueId, actor };
  if (/^pr-create\b/.test(args)) return { kind: 'pr-create', actor };
  if (/^pr-list\b/.test(args)) return { kind: 'pr-list' };
  if (/^pr-view\b/.test(args)) return { kind: 'pr-view', prId };
  if (/^pr-edit\b/.test(args)) return { kind: 'pr-edit', prId, actor };
  if (/^query\b/.test(args)) return { kind: 'query' };
  return { kind: 'unknown', actor };
}

function checkIssueAccessInCommand(command, issuePolicy = null) {
  if (!issuePolicy) return null;
  const parsed = extractTbcDbCommand(command);
  if (!parsed) return null;

  const actor = issuePolicy.actor || null;
  const mutatingKinds = new Set(['issue-create', 'comment', 'issue-edit', 'issue-close', 'pr-create', 'pr-edit']);
  if (actor && mutatingKinds.has(parsed.kind)) {
    if (!parsed.actor) {
      return `Blocked: ${parsed.kind} requires --actor ${actor}.`;
    }
    if (parsed.actor !== actor) {
      return `Blocked: agent ${actor} cannot act as ${parsed.actor}. Use --actor ${actor}.`;
    }
  }

  const mode = issuePolicy.mode || 'full';
  if (mode === 'full') return null;

  if (mode === 'blind') {
    if (parsed.kind === 'issue-create' || parsed.kind === 'pr-create') return null;
    return 'Blocked: blind mode cannot view the issue tracker or PR board. Work only from the task and repository; you may still create a new issue or PR record if needed.';
  }

  if (mode === 'focused') {
    if (parsed.kind === 'issue-create' || parsed.kind === 'pr-create') return null;
    return 'Blocked: focused mode cannot view the issue tracker or PR board. Work from the task, repository, shared knowledge, and your own notes; you may still create a new issue or PR record if needed.';
  }

  return null;
}

function normalizePath(targetPath) {
  const resolved = path.resolve(targetPath);
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved);
  } catch {
    const dir = path.dirname(resolved);
    if (dir && dir !== resolved) {
      try {
        const realDir = fs.realpathSync.native ? fs.realpathSync.native(dir) : fs.realpathSync(dir);
        return path.join(realDir, path.basename(resolved));
      } catch {}
    }
    return resolved;
  }
}

function isSubpath(targetPath, basePath) {
  const target = normalizePath(targetPath);
  const base = normalizePath(basePath);
  return target === base || target.startsWith(base + path.sep);
}

function resolveToolPath(inputPath, cwd) {
  if (!inputPath || typeof inputPath !== 'string') return null;
  return path.isAbsolute(inputPath) ? normalizePath(inputPath) : normalizePath(path.join(cwd, inputPath));
}

function isRawDbPath(targetPath, allowedPaths = null) {
  if (!allowedPaths?.dbPath) return false;
  return normalizePath(targetPath) === normalizePath(allowedPaths.dbPath);
}

function isPathAllowed(targetPath, allowedPaths = null, access = 'read') {
  if (!allowedPaths) return true;
  const resolved = normalizePath(targetPath);
  const allowed = access === 'write' ? (allowedPaths.write || []) : (allowedPaths.read || []);
  if (allowed.some(base => isSubpath(resolved, base))) return true;
  const denied = allowedPaths.denied || [];
  for (const denyPath of denied) {
    if (isSubpath(resolved, denyPath)) return false;
  }
  return false;
}

function extractPathCandidates(command) {
  const candidates = new Set();
  if (!command) return [];

  const quoted = [...command.matchAll(/(["'])(.*?)\1/g)];
  for (const match of quoted) {
    const value = match[2]?.trim();
    if (value && /^(\/|\.\.?\/)/.test(value)) candidates.add(value);
  }

  const bare = command.match(/(?:^|\s)(\/[^\s|;&]+|\.\.?\/[^\s|;&]+)/g) || [];
  for (const token of bare) {
    const value = token.trim();
    if (value) candidates.add(value);
  }

  return [...candidates];
}

function checkPathAccessInCommand(command, cwd, allowedPaths = null) {
  if (!allowedPaths) return null;
  for (const candidate of extractPathCandidates(command)) {
    const resolved = resolveToolPath(candidate, cwd);
    if (!resolved) continue;
    if (isRawDbPath(resolved, allowedPaths)) {
      return 'Blocked: raw project database access is not allowed. Use tbc-db CLI for project database operations.';
    }
    if (!isPathAllowed(resolved, allowedPaths, 'read') && !isPathAllowed(resolved, allowedPaths, 'write')) {
      return `Blocked: access denied for ${resolved}`;
    }
  }
  return null;
}

function buildSandboxProfile(allowedPaths) {
  const lines = [
    '(version 1)',
    '(allow default)',
  ];
  for (const denyPath of (allowedPaths?.denied || [])) {
    const p = normalizePath(denyPath).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    lines.push(`(deny file-read-data (subpath "${p}"))`);
    lines.push(`(deny file-read-metadata (subpath "${p}"))`);
    lines.push(`(deny file-write* (subpath "${p}"))`);
  }
  for (const allowPath of (allowedPaths?.read || [])) {
    const p = normalizePath(allowPath).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    lines.push(`(allow file-read-data (subpath "${p}"))`);
    lines.push(`(allow file-read-metadata (subpath "${p}"))`);
  }
  for (const allowPath of (allowedPaths?.write || [])) {
    const p = normalizePath(allowPath).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    lines.push(`(allow file-write* (subpath "${p}"))`);
  }
  if (allowedPaths?.dbPath) {
    const p = normalizePath(allowedPaths.dbPath).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    lines.push(`(allow file-read-data (literal "${p}"))`);
    lines.push(`(allow file-read-metadata (literal "${p}"))`);
    lines.push(`(allow file-write* (literal "${p}"))`);
  }
  return lines.join('\n');
}

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
const MAX_TEXT_TOOL_FILE_BYTES = 2 * 1024 * 1024;

function grepFiles(pattern, searchPath, options = {}) {
  const results = [];
  const isDir = fs.statSync(searchPath).isDirectory();
  const regex = new RegExp(pattern, options.caseInsensitive ? 'gi' : 'g');

  function searchFile(filePath) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > MAX_TEXT_TOOL_FILE_BYTES) {
        return;
      }
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
function executeBash(input, cwd, remainingMs = 0, bashEnv = null, runtime = null, allowedRepo = null, allowedPaths = null, issuePolicy = null) {
  let timeout = Math.min(input.timeout || 120000, 600000);
  if (remainingMs > 0) {
    timeout = Math.min(timeout, remainingMs);
  }
  const originalCommand = input.command;
  // Strip any TBC_DB overrides — agents must use the injected env value
  let command = originalCommand;
  command = command.replace(/\bexport\s+TBC_DB=[^\s;|&]*/g, 'true');
  command = command.replace(/\bTBC_DB=[^\s;|&]*/g, 'true');
  return new Promise((resolve) => {
    if (runtime?.signal?.aborted) {
      resolve({ output: 'Command cancelled: agent was terminated.', exitCode: null, ok: false });
      return;
    }

    const gitBlock = checkGitCommand(command, allowedRepo);
    if (gitBlock) {
      resolve({ output: gitBlock, exitCode: 1, ok: false });
      return;
    }
    const dbBlock = checkSensitiveDbAccess(originalCommand);
    if (dbBlock) {
      resolve({ output: dbBlock, exitCode: 1, ok: false });
      return;
    }
    const logBlock = checkSensitiveLogAccess(originalCommand, allowedPaths);
    if (logBlock) {
      resolve({ output: logBlock, exitCode: 1, ok: false });
      return;
    }
    const issueBlock = checkIssueAccessInCommand(command, issuePolicy);
    if (issueBlock) {
      resolve({ output: issueBlock, exitCode: 1, ok: false });
      return;
    }
    const pathBlock = checkPathAccessInCommand(command, cwd, allowedPaths);
    if (pathBlock) {
      resolve({ output: pathBlock, exitCode: 1, ok: false });
      return;
    }

    let spawnCmd = 'bash';
    let spawnArgs = ['-c', command];
    let sandboxProfilePath = null;
    if (allowedPaths && os.platform() === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec')) {
      sandboxProfilePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tbc-sb-')), 'profile.sb');
      fs.writeFileSync(sandboxProfilePath, buildSandboxProfile(allowedPaths));
      spawnCmd = '/usr/bin/sandbox-exec';
      spawnArgs = ['-f', sandboxProfilePath, 'bash', '-c', command];
    }

    const proc = spawn(spawnCmd, spawnArgs, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,  // new process group so grandchildren can be killed too
      timeout,
      env: bashEnv ? { ...process.env, ...bashEnv } : process.env,
    });
    proc.unref();  // don't keep the event loop alive
    runtime?.registerProcess?.(proc);

    const stdout = createCappedOutputBuffer();
    const stderr = createCappedOutputBuffer();
    let settled = false;
    proc.stdout.on('data', (d) => { stdout.append(d); });
    proc.stderr.on('data', (d) => { stderr.append(d); });

    const killProc = (signal) => {
      // Kill the entire process group (negative pid) to catch grandchildren
      try { process.kill(-proc.pid, signal); } catch {}
    };
    const onAbort = () => {
      killProc('SIGTERM');
      setTimeout(() => killProc('SIGKILL'), 5000);
    };
    runtime?.signal?.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(() => {
      killProc('SIGTERM');
      setTimeout(() => killProc('SIGKILL'), 5000);
    }, timeout);

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      runtime?.signal?.removeEventListener('abort', onAbort);
      runtime?.unregisterProcess?.(proc);
      let result = '';
      const stdoutText = stdout.toString();
      const stderrText = stderr.toString();
      if (stdoutText) result += stdoutText;
      if (stderrText) result += (result ? '\n' : '') + stderrText;
      if (code !== 0 && code !== null) {
        result += `\nExit code: ${code}`;
      }
      if (sandboxProfilePath) {
        try { fs.rmSync(path.dirname(sandboxProfilePath), { recursive: true, force: true }); } catch {}
      }
      resolve({ output: result || '(no output)', exitCode: code, ok: code === 0 });
    });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      runtime?.signal?.removeEventListener('abort', onAbort);
      runtime?.unregisterProcess?.(proc);
      if (sandboxProfilePath) {
        try { fs.rmSync(path.dirname(sandboxProfilePath), { recursive: true, force: true }); } catch {}
      }
      resolve({ output: `Error executing command: ${err.message}`, exitCode: null, ok: false });
    });

    // Guard against grandchild processes keeping pipe FDs open after the main
    // bash process exits. Node.js won't emit 'close' until every inherited copy
    // of the pipe write-end is closed, so if any grandchild lingers the Promise
    // would hang forever — even after SIGKILL on the bash process itself.
    // Destroying the streams after a short drain period forces 'close' to fire.
    proc.on('exit', () => {
      setTimeout(() => {
        if (!settled) {
          try { proc.stdout.destroy(); } catch {}
          try { proc.stderr.destroy(); } catch {}
        }
      }, 500);
    });
  });
}

const MAX_BASH_STREAM_OUTPUT_CHARS = 100000;
const BASH_OUTPUT_HEAD_CHARS = 50000;
const BASH_OUTPUT_TAIL_CHARS = 50000;
const BASH_OUTPUT_TRUNCATION_MARKER = '\n\n... (output truncated) ...\n\n';
const MAX_TOOL_RESULT_MESSAGE_CHARS = 12000;
const TOOL_RESULT_DISPLAY_CHARS = 4000;

function truncateForModel(text, maxChars = MAX_TOOL_RESULT_MESSAGE_CHARS) {
  if (typeof text !== 'string') return JSON.stringify(text);
  if (text.length <= maxChars) return text;
  const headChars = Math.ceil(maxChars * 0.6);
  const tailChars = Math.max(0, maxChars - headChars);
  return `${text.slice(0, headChars)}${BASH_OUTPUT_TRUNCATION_MARKER}${tailChars > 0 ? text.slice(-tailChars) : ''}`;
}

function createCappedOutputBuffer(maxChars = MAX_BASH_STREAM_OUTPUT_CHARS) {
  const headChars = Math.min(BASH_OUTPUT_HEAD_CHARS, maxChars);
  const tailChars = Math.max(0, maxChars - headChars);
  let full = '';
  let head = '';
  let tail = '';
  let truncated = false;

  return {
    append(chunk) {
      if (!chunk) return;
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (!text) return;

      if (!truncated) {
        if (full.length + text.length <= maxChars) {
          full += text;
          return;
        }

        truncated = true;
        head = full.slice(0, headChars);
        const headFromChunk = Math.max(0, headChars - head.length);
        if (headFromChunk > 0) {
          head += text.slice(0, headFromChunk);
        }
        if (tailChars > 0) {
          if (text.length >= tailChars) {
            tail = text.slice(-tailChars);
          } else {
            const carry = Math.max(0, tailChars - text.length);
            tail = full.slice(-carry) + text;
          }
        }
        full = '';
        return;
      }

      if (tailChars <= 0) return;
      if (text.length >= tailChars) {
        tail = text.slice(-tailChars);
        return;
      }
      const carry = Math.max(0, tailChars - text.length);
      tail = tail.slice(-carry) + text;
    },
    toString() {
      if (!truncated) return full;
      return `${head}${BASH_OUTPUT_TRUNCATION_MARKER}${tail}`;
    },
  };
}

function executeRead(input, cwd, allowedPaths = null) {
  let filePath = input.file_path;
  if (!filePath || typeof filePath !== 'string') return 'Error: file_path is required and must be a string';
  filePath = resolveToolPath(filePath, cwd);
  if (isRawDbPath(filePath, allowedPaths)) return 'Error: raw project database access is not allowed. Use tbc-db CLI.';
  if (!isPathAllowed(filePath, allowedPaths, 'read')) return `Error: access denied for ${filePath}`;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return `Error reading file: ${filePath} is not a regular file`;
    if (stat.size > MAX_TEXT_TOOL_FILE_BYTES) {
      return `Error reading file: ${filePath} is too large for the Read tool (${stat.size} bytes > ${MAX_TEXT_TOOL_FILE_BYTES} byte limit)`;
    }
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

function executeWrite(input, cwd, allowedPaths = null) {
  let filePath = input.file_path;
  if (!filePath || typeof filePath !== 'string') return 'Error: file_path is required and must be a string';
  filePath = resolveToolPath(filePath, cwd);
  if (isRawDbPath(filePath, allowedPaths)) return 'Error: raw project database access is not allowed. Use tbc-db CLI.';
  if (!isPathAllowed(filePath, allowedPaths, 'write')) return `Error: access denied for ${filePath}`;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, input.content);
    return `Successfully wrote to ${filePath}`;
  } catch (err) {
    return `Error writing file: ${err.message}`;
  }
}

function executeEdit(input, cwd, allowedPaths = null) {
  let filePath = input.file_path;
  if (!filePath || typeof filePath !== 'string') return 'Error: file_path is required and must be a string';
  filePath = resolveToolPath(filePath, cwd);
  if (isRawDbPath(filePath, allowedPaths)) return 'Error: raw project database access is not allowed. Use tbc-db CLI.';
  if (!isPathAllowed(filePath, allowedPaths, 'write')) return `Error: access denied for ${filePath}`;
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

function executeGlob(input, cwd, allowedPaths = null) {
  const searchPath = input.path || cwd;
  const resolvedPath = path.isAbsolute(searchPath) ? normalizePath(searchPath) : normalizePath(path.join(cwd, searchPath));
  if (!isPathAllowed(resolvedPath, allowedPaths, 'read')) return `Error: access denied for ${resolvedPath}`;
  try {
    const files = globFiles(input.pattern, resolvedPath);
    if (files.length === 0) return 'No files matched the pattern.';
    return files.join('\n');
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

function executeGrep(input, cwd, allowedPaths = null) {
  const searchPath = input.path || cwd;
  const resolvedPath = path.isAbsolute(searchPath) ? normalizePath(searchPath) : normalizePath(path.join(cwd, searchPath));
  if (!isPathAllowed(resolvedPath, allowedPaths, 'read')) return `Error: access denied for ${resolvedPath}`;
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

function normalizeToolExecutionResult(toolName, result) {
  if (toolName === 'Bash') {
    if (result && typeof result === 'object' && 'output' in result) return result;
    return { output: typeof result === 'string' ? result : JSON.stringify(result), exitCode: null, ok: false };
  }
  return {
    output: typeof result === 'string' ? result : JSON.stringify(result),
    exitCode: null,
    ok: !(typeof result === 'string' && result.trim().startsWith('Error:')),
  };
}

async function executeToolDetailed(toolName, toolInput, cwd, remainingMs = 0, bashEnv = null, runtime = null, allowedRepo = null, allowedPaths = null, issuePolicy = null) {
  switch (toolName) {
    case 'Bash':  return normalizeToolExecutionResult('Bash', await executeBash(toolInput, cwd, remainingMs, bashEnv, runtime, allowedRepo, allowedPaths, issuePolicy));
    case 'Read':  return normalizeToolExecutionResult('Read', executeRead(toolInput, cwd, allowedPaths));
    case 'Write': return normalizeToolExecutionResult('Write', executeWrite(toolInput, cwd, allowedPaths));
    case 'Edit':  return normalizeToolExecutionResult('Edit', executeEdit(toolInput, cwd, allowedPaths));
    case 'Glob':  return normalizeToolExecutionResult('Glob', executeGlob(toolInput, cwd, allowedPaths));
    case 'Grep':  return normalizeToolExecutionResult('Grep', executeGrep(toolInput, cwd, allowedPaths));
    default:      return normalizeToolExecutionResult(toolName, `Unknown tool: ${toolName}`);
  }
}

async function executeTool(toolName, toolInput, cwd, remainingMs = 0, bashEnv = null, runtime = null, allowedRepo = null, allowedPaths = null, issuePolicy = null) {
  const result = await executeToolDetailed(toolName, toolInput, cwd, remainingMs, bashEnv, runtime, allowedRepo, allowedPaths, issuePolicy);
  return result.output;
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
 * @param {AbortSignal} opts.abortSignal - Optional external abort signal
 * @param {function} opts.log        - Logging function (optional)
 * @param {function} opts.onRateLimited - Callback when rate limited: (keyId) => void
 * @param {function} opts.resolveNewToken - Async callback to get new token after rotation: () => { token, keyId }
 * @returns {Promise<Object>}        - { success, resultText, usage, cost, durationMs }
 */
export async function runAgentWithAPI(opts) {
  const {
    prompt,
    model: rawModel = 'claude-opus-4-6',
    token: initialToken,
    keyType = 'api',
    provider: initialProvider = null,
    customConfig: initialCustomConfig = null,
    reasoningEffort: initialReasoningEffort,
    cwd,
    timeoutMs = 0,
    env = {},
    abortSignal = null,
    log = () => {},
    allowedRepo = null,
    allowedPaths = null,
    issuePolicy = null,
    keyId: initialKeyId = null,
    onRateLimited = null,
    resolveNewToken = null,
    onProgress = null,
    onEvent = () => {},
  } = opts;

  const startTime = Date.now();
  let { piModel } = resolveModel(rawModel, initialProvider);
  let token = initialToken;
  let keyId = initialKeyId;
  let isOAuth = keyType === 'oauth';
  let keyProvider = initialProvider;
  let customConfig = initialCustomConfig;
  let reasoningEffort = initialReasoningEffort;

  // Format tools for pi-ai
  const canonicalTools = getToolDefinitions();
  const tools = formatTools(canonicalTools);

  // Set up env for Bash commands
  const bashEnv = { ...process.env, ...env };

  // Accumulated usage (normalized)
  const totalUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

  // Hard timeout / external cancel: abort API calls and kill in-flight tool subprocesses
  let aborted = false;
  let abortReason = null;
  const abortController = new AbortController();
  const runningProcesses = new Set();
  const runtime = {
    signal: abortController.signal,
    registerProcess: (proc) => runningProcesses.add(proc),
    unregisterProcess: (proc) => runningProcesses.delete(proc),
  };

  const killRunningProcesses = (signal) => {
    for (const proc of runningProcesses) {
      // Kill entire process group to prevent orphaned grandchildren
      try { process.kill(-proc.pid, signal); } catch {}
    }
  };

  const abortRun = (reason) => {
    if (aborted) return;
    aborted = true;
    abortReason = reason;
    abortController.abort();
    killRunningProcesses('SIGTERM');
    setTimeout(() => killRunningProcesses('SIGKILL'), 5000);
  };

  let externalAbortHandler = null;
  if (abortSignal) {
    if (abortSignal.aborted) {
      abortRun('killed');
    } else {
      externalAbortHandler = () => abortRun('killed');
      abortSignal.addEventListener('abort', externalAbortHandler, { once: true });
    }
  }

  let hardTimeoutTimer;
  if (timeoutMs > 0) {
    hardTimeoutTimer = setTimeout(() => {
      abortRun('timeout');
      log(`⏰ Hard timeout after ${Math.floor((Date.now() - startTime) / 60000)}m`);
    }, timeoutMs);
  }

  // Track all key IDs used during this run
  const keysUsed = initialKeyId ? [initialKeyId] : [];

  // Helper to build result object
  function makeResult(success, resultText, extra = {}) {
    return {
      success,
      resultText,
      usage: totalUsage,
      cost: totalCost,
      durationMs: Date.now() - startTime,
      keyId,
      keysUsed,
      ...extra,
    };
  }

  // Accumulated cost (from pi-ai per-call cost)
  let totalCost = 0;

  // Initial messages in pi-ai format
  const messages = [
    buildUserMessage('Begin your work now. Follow the instructions in the system prompt.'),
  ];

  const MAX_ITERATIONS = 200;
  let lastResultText = '';
  let lastInputTokens = 0;

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      if (aborted || (timeoutMs > 0 && (Date.now() - startTime) >= timeoutMs)) {
        const isTimeout = abortReason === 'timeout' || (timeoutMs > 0 && (Date.now() - startTime) >= timeoutMs);
        log(`Agent ${isTimeout ? 'timeout' : 'termination'} after ${iteration} iterations`);
        return makeResult(false, lastResultText || (isTimeout ? 'Agent timed out' : 'Agent was terminated'), { timedOut: isTimeout });
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
          if (msg.role === 'toolResult') {
            splitIdx--; // include the preceding assistant message
          } else {
            break;
          }
        }
        if (splitIdx < 1) splitIdx = 1;
        const toCompact = messages.splice(1, splitIdx - 1);
        log(`Compacting ${toCompact.length} messages (last request: ${lastInputTokens} tokens)...`);

        // Build a text representation of old messages for summarization
        const compactText = toCompact.map((m) => {
          const role = m.role || 'unknown';
          let text = '';
          if (Array.isArray(m.content)) {
            text = m.content.map(c => {
              if (c.type === 'text') return c.text;
              if (c.type === 'toolCall') return `[Tool call: ${c.name}(${JSON.stringify(c.arguments).slice(0, 200)})]`;
              return `[${c.type}]`;
            }).join('\n');
          } else if (typeof m.content === 'string') {
            text = m.content;
          }
          if (role === 'toolResult') {
            const resultText = m.content?.map(c => c.text || '').join('') || '';
            text = `[Tool result for ${m.toolName}: ${resultText.slice(0, 500)}]`;
          }
          return `[${role}] ${text.slice(0, 1000)}`;
        }).join('\n---\n');

        // Use a cheap/fast model for summarization
        try {
          // Pick a cheaper model for summarization if available
          let summaryModelName = rawModel;
          if (rawModel.includes('opus')) summaryModelName = rawModel.replace('opus', 'sonnet');
          const { piModel: summaryPiModel } = resolveModel(summaryModelName, keyProvider);

          const summaryResponse = await callModel(
            summaryPiModel,
            'Summarize this agent conversation history concisely. Focus on: what tasks were attempted, what succeeded/failed, what files were modified, current state, and any important decisions. Be specific about file paths, issue numbers, and error messages. Output only the summary.',
            [buildUserMessage(compactText.slice(0, 80000))],
            [], // no tools for summarization
            { token, isOAuth, provider: keyProvider, customConfig, signal: abortController.signal },
          );

          totalUsage.inputTokens += summaryResponse.usage.inputTokens;
          totalUsage.outputTokens += summaryResponse.usage.outputTokens;
          totalUsage.cacheReadTokens += summaryResponse.usage.cacheReadTokens || 0;
          totalCost += summaryResponse.cost || 0;

          const summary = summaryResponse.content || '(compaction failed — earlier context was dropped)';
          log(`Compacted ${toCompact.length} messages into summary (${summary.length} chars)`);

          messages.splice(1, 0,
            buildUserMessage(`[System: The conversation history was auto-compacted to stay within context limits. Here is a summary of the earlier work:]\n\n${summary}`),
          );
        } catch (compactErr) {
          log(`Compaction summarization failed: ${compactErr.message}, falling back to trim`);
          messages.splice(1, 0,
            buildUserMessage(`[System: ${toCompact.length} earlier messages were trimmed to stay within context limits. Continue your work based on what you can see.]`),
          );
        }
      }

      // Prepare system prompt (add Claude Code prefix for Anthropic OAuth)
      let systemPrompt = prompt;
      if (isOAuth && piModel.provider === 'anthropic') {
        systemPrompt = 'You are Claude Code, Anthropic\'s official CLI for Claude.\n\n' + systemPrompt;
      }

      // Call API with retry for transient errors (429, 503)
      let response;
      let contextCompacted = false; // track emergency compaction to prevent loops
      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          response = await callModel(piModel, systemPrompt, messages, tools, {
            token, isOAuth, provider: keyProvider, customConfig, reasoningEffort, signal: abortController.signal,
          });
          break; // success
        } catch (err) {
          if (aborted || err.name === 'AbortError' || abortController.signal.aborted) {
            log(`Agent ${abortReason === 'timeout' ? 'timeout' : 'termination'} during API call`);
            return makeResult(false, lastResultText || (abortReason === 'timeout' ? 'Agent timed out' : 'Agent was terminated'), { timedOut: abortReason === 'timeout' });
          }
          const status = err.status || err.code || 0;
          const isRetryable = status === 429 || status === 503 || status === 401 || /rate.limit|usage.limit|overloaded|unavailable|quota|authentication_error|invalid.*api.key/i.test(err.message);
          if (isRetryable) {
            // Mark the current key unavailable, then fail this agent call.
            // The outer orchestrator retry loop will start fresh from the top
            // of the globally ordered key pool and skip cooled-down keys.
            const cooldownMs = parseRetryCooldown(err.message);

            if (onRateLimited && keyId) {
              onRateLimited(keyId, cooldownMs);
              log(`Key ${keyId} rate-limited for ${Math.ceil(cooldownMs / 60_000)}m`);
            }

            return makeResult(false, err.message, {
              provider: keyProvider || provider,
              keyId,
              keyIdTried: keyId,
              retryable: true,
            });
          }
          // Context length exceeded — emergency compact and retry once
          const isContextError = /context_length_exceeded|context.window|too.many.tokens|maximum.context/i.test(err.message);
          if (isContextError && messages.length > 3 && !contextCompacted) {
            log(`Context length exceeded — emergency compaction (${messages.length} messages)...`);
            // Aggressively compact: keep only first message + last 20% of history
            const keep = Math.max(2, Math.floor(messages.length * 0.2));
            let splitIdx = messages.length - keep;
            // Don't split assistant/tool-result pairs
            while (splitIdx < messages.length - 1) {
              const msg = messages[splitIdx];
              if (msg.role === 'toolResult') { splitIdx--; } else { break; }
            }
            if (splitIdx < 1) splitIdx = 1;
            const toCompact = messages.splice(1, splitIdx - 1);
            log(`Emergency compact: removed ${toCompact.length} messages, ${messages.length} remaining`);

            // Build summary text from compacted messages
            const compactText = toCompact.map((m) => {
              const role = m.role || 'unknown';
              let text = '';
              if (Array.isArray(m.content)) {
                text = m.content.map(c => {
                  if (c.type === 'text') return c.text;
                  if (c.type === 'toolCall') return `[Tool: ${c.name}]`;
                  return `[${c.type}]`;
                }).join('\n');
              } else if (typeof m.content === 'string') {
                text = m.content;
              }
              if (role === 'toolResult') {
                const resultText = m.content?.map(c => c.text || '').join('') || '';
                text = `[Tool result for ${m.toolName}: ${resultText.slice(0, 300)}]`;
              }
              return `[${role}] ${text.slice(0, 500)}`;
            }).join('\n---\n');

            // Try to summarize, fall back to simple trim
            try {
              let summaryModelName = rawModel;
              if (rawModel.includes('opus')) summaryModelName = rawModel.replace('opus', 'sonnet');
              if (rawModel.includes('codex')) summaryModelName = rawModel; // codex has no cheaper variant
              const { piModel: summaryPiModel } = resolveModel(summaryModelName, keyProvider);
              const summaryResponse = await callModel(
                summaryPiModel,
                'Summarize this agent conversation concisely. Focus on: tasks attempted, results, files modified, current state. Be specific. Output only the summary.',
                [buildUserMessage(compactText.slice(0, 40000))], // smaller slice for emergency
                [],
                { token, isOAuth, provider: keyProvider, customConfig, signal: abortController.signal },
              );
              totalUsage.inputTokens += summaryResponse.usage.inputTokens;
              totalUsage.outputTokens += summaryResponse.usage.outputTokens;
              totalCost += summaryResponse.cost || 0;
              const summary = summaryResponse.content || '(context was trimmed)';
              log(`Emergency compaction summary: ${summary.length} chars`);
              messages.splice(1, 0,
                buildUserMessage(`[System: Context was too large. ${toCompact.length} earlier messages were compacted. Summary:]\n\n${summary}`),
              );
            } catch (compactErr) {
              log(`Emergency compaction summarization failed: ${compactErr.message}`);
              messages.splice(1, 0,
                buildUserMessage(`[System: ${toCompact.length} earlier messages were trimmed due to context limits. Continue based on what you can see.]`),
              );
            }
            contextCompacted = true; // prevent infinite compaction loops
            attempt--; // don't count this as a retry attempt
            continue; // retry the API call with compacted history
          }

          log(`API error: ${err.message}`);
          return makeResult(false, `API error: ${err.message}`);
        }
      }

      if (aborted) {
        totalUsage.inputTokens += response.usage.inputTokens;
        totalUsage.outputTokens += response.usage.outputTokens;
        totalUsage.cacheReadTokens += response.usage.cacheReadTokens || 0;
        totalCost += response.cost || 0;
        log(`Agent timeout after API call (iteration ${iteration})`);
        return makeResult(false, lastResultText || (abortReason === 'timeout' ? 'Agent timed out' : 'Agent was terminated'), { timedOut: abortReason === 'timeout' });
      }

      // Accumulate usage
      lastInputTokens = response.usage.inputTokens;
      totalUsage.inputTokens += response.usage.inputTokens;
      totalUsage.outputTokens += response.usage.outputTokens;
      totalUsage.cacheReadTokens += response.usage.cacheReadTokens || 0;
      totalCost += response.cost || 0;

      // Report progress (live cost/tokens for dashboard)
      if (onProgress) onProgress({ usage: { ...totalUsage }, cost: totalCost });

      // Extract text
      if (response.content) {
        lastResultText = response.content;
        onEvent({ type: 'thinking', content: response.content });
      }

      // Check stop reason
      if (response.stopReason === 'end_turn' || response.stopReason === 'max_tokens') {
        return makeResult(true, lastResultText);
      }

      // Handle tool use
      if (response.stopReason === 'tool_use') {
        // Add assistant message to history
        messages.push(buildAssistantMessage(response));

        // Execute tools
        const toolResults = [];
        for (const tc of response.toolCalls) {
          if (aborted) break;

          log(`Tool: ${tc.name}${tc.name === 'Bash' ? ` → ${(tc.input.command || '').slice(0, 300)}` : ''}`);
          onEvent({ type: 'tool_call', id: tc.id, name: tc.name, input: tc.input });

          const remainingMs = timeoutMs > 0 ? Math.max(0, timeoutMs - (Date.now() - startTime)) : 0;
          const normalized = await executeToolDetailed(tc.name, tc.input, cwd, remainingMs, bashEnv, runtime, allowedRepo, allowedPaths, issuePolicy);
          const modelOutput = truncateForModel(normalized.output);
          toolResults.push({ toolCallId: tc.id, toolName: tc.name, content: modelOutput });
          const displayOutput = modelOutput.length > TOOL_RESULT_DISPLAY_CHARS ? modelOutput.slice(0, TOOL_RESULT_DISPLAY_CHARS) + '\n... (truncated)' : modelOutput;
          onEvent({ type: 'tool_result', id: tc.id, name: tc.name, output: displayOutput, exitCode: normalized.exitCode, ok: normalized.ok });
        }

        if (aborted) {
          log(`Agent timeout during tool execution (iteration ${iteration})`);
          return makeResult(false, lastResultText || (abortReason === 'timeout' ? 'Agent timed out' : 'Agent was terminated'), { timedOut: abortReason === 'timeout' });
        }

        // Add tool results to messages
        for (const trMsg of buildToolResultMessages(toolResults)) {
          messages.push(trMsg);
        }
      } else {
        log(`Unexpected stop reason: ${response.stopReason}`);
        return makeResult(true, lastResultText);
      }
    }

    return makeResult(false, lastResultText || 'Agent exceeded maximum iterations');
  } finally {
    if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
    if (externalAbortHandler) {
      abortSignal.removeEventListener('abort', externalAbortHandler);
    }
  }
}

// Exported for testing
export { executeRead, executeWrite, executeEdit, executeGlob, executeGrep, executeTool, executeToolDetailed };
