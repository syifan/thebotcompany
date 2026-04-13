import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import vm from 'node:vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'src', 'server.js');
const scheduleDiagramPath = path.join(__dirname, '..', 'monitor', 'src', 'components', 'ScheduleDiagram.jsx');

function extractMethod(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Could not find ${signature}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.notEqual(end, -1, `Could not extract ${signature}`);
  return source.slice(start, end + 1);
}

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Could not find ${signature}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.notEqual(end, -1, `Could not extract ${signature}`);
  return source.slice(start, end + 1);
}

function loadServerParseSchedule() {
  const src = fs.readFileSync(serverPath, 'utf-8');
  const method = extractMethod(src, 'parseSchedule(resultText)');
  const fnSource = method.replace('parseSchedule(resultText)', 'function parseSchedule(resultText)');
  const wrapped = `(() => { ${fnSource}; return parseSchedule; })()`;
  return vm.runInNewContext(wrapped, { log: () => {} });
}

function loadFrontendParseScheduleBlock() {
  const src = fs.readFileSync(scheduleDiagramPath, 'utf-8');
  const normalizeStep = extractFunction(src, 'function normalizeStep(step)');
  const normalizeSteps = extractFunction(src, 'function normalizeSteps(schedule)');
  const parseScheduleBlock = extractFunction(src, 'export function parseScheduleBlock(text)').replace('export function', 'function');
  const wrapped = `(() => { ${normalizeStep}\n${normalizeSteps}\n${parseScheduleBlock}; return parseScheduleBlock; })()`;
  return vm.runInNewContext(wrapped, {});
}

describe('strict schedule directive format', () => {
  it('accepts only the canonical array-of-steps format in the backend parser', () => {
    const parseSchedule = loadServerParseSchedule();
    const canonical = `<!-- SCHEDULE -->\n[\n  {"agent":"diana","issue":2,"title":"Research","task":"Do it"},\n  {"delay":20}\n]\n<!-- /SCHEDULE -->`;
    assert.equal(JSON.stringify(parseSchedule(canonical)), JSON.stringify({
      _steps: [
        { diana: { issue: 2, title: 'Research', task: 'Do it' } },
        { delay: 20 },
      ],
    }));
  });

  it('rejects the old object-style schedule format in the backend parser', () => {
    const parseSchedule = loadServerParseSchedule();
    const legacy = `<!-- SCHEDULE -->\n{"agents":{"delay":20,"diana":{"issue":2,"title":"Research","prompt":"Do it"}}}\n<!-- /SCHEDULE -->`;
    assert.equal(parseSchedule(legacy), null);
  });

  it('rejects the old object-style schedule format in the frontend parser', () => {
    const parseScheduleBlock = loadFrontendParseScheduleBlock();
    const legacy = `<!-- SCHEDULE -->\n{"agents":{"delay":20,"diana":{"issue":2,"title":"Research","prompt":"Do it"}}}\n<!-- /SCHEDULE -->`;
    assert.equal(parseScheduleBlock(legacy), null);
  });
});
