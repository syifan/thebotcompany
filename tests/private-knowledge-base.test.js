import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'src', 'orchestrator', 'ProjectRunner.js');
const stateControlPath = path.join(__dirname, '..', 'src', 'orchestrator', 'state-control.js');
const lifecyclePath = path.join(__dirname, '..', 'src', 'orchestrator', 'lifecycle.js');

function read(file) {
  return fs.readFileSync(file, 'utf-8');
}

describe('private knowledge base for spec, roadmap, and internal analysis docs', () => {
  it('defines a shared knowledge-base path outside the repo root', () => {
    const src = read(serverPath);
    assert.match(src, /get knowledgeDir\(\)/, 'Expected a knowledgeDir getter in ProjectRunner.js');
    assert.match(src, /path\.join\(this\.projectDir, 'knowledge'\)/,
      'Expected knowledge base to live under project knowledge/, not the repo root');
  });

  it('bootstrap preview should read spec/roadmap from knowledge base, not repo root', () => {
    const src = `${read(serverPath)}\n${read(lifecyclePath)}`;
    assert.doesNotMatch(src, /path\.join\((?:this|runner)\.path, 'spec\.md'\)/,
      'bootstrap preview should not read spec.md from the repo root');
    assert.doesNotMatch(src, /path\.join\((?:this|runner)\.path, 'roadmap\.md'\)/,
      'bootstrap preview should not read roadmap.md from the repo root');
    assert.match(src, /path\.join\((?:this|runner)\.knowledgeDir, 'spec\.md'\)/,
      'bootstrap preview should read spec.md from private knowledge dir');
    assert.match(src, /path\.join\((?:this|runner)\.knowledgeDir, 'roadmap\.md'\)/,
      'bootstrap preview should read roadmap.md from private knowledge dir');
  });

  it('startup/bootstrap should create the private knowledge directory and subfolders for internal docs', () => {
    const src = `${read(serverPath)}\n${read(stateControlPath)}`;
    assert.match(src, /'knowledge'/,
      'Expected startup/bootstrap logic to create a knowledge directory');
    assert.match(src, /knowledge', 'analysis'|path\.join\('knowledge', 'analysis'\)|'knowledge\/analysis'/,
      'Expected a private analysis subdirectory under knowledge/');
    assert.match(src, /knowledge', 'decisions'|path\.join\('knowledge', 'decisions'\)|'knowledge\/decisions'/,
      'Expected a private decisions subdirectory under knowledge/');
  });

  it('repo-root spec/roadmap and internal analysis docs should no longer be canonical private artifacts', () => {
    const src = read(serverPath);
    assert.doesNotMatch(src, /Read spec\.md and check roadmap\.md from project repo/,
      'ProjectRunner.js comments should not describe repo-root planning files as canonical');
  });
});
