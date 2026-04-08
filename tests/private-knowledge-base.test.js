import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'src', 'server.js');
const athenaPath = path.join(__dirname, '..', 'agent', 'managers', 'athena.md');

function read(file) {
  return fs.readFileSync(file, 'utf-8');
}

describe('private knowledge base for spec and roadmap', () => {
  it('defines a shared knowledge-base path outside the repo root', () => {
    const src = read(serverPath);
    assert.match(src, /get knowledgeDir\(\)/, 'Expected a knowledgeDir getter in server.js');
    assert.match(src, /path\.join\(this\.agentDir, 'knowledge'\)/,
      'Expected knowledge base to live under private workspace/knowledge, not the repo root');
  });

  it('bootstrap preview should read spec/roadmap from knowledge base, not repo root', () => {
    const src = read(serverPath);
    assert.doesNotMatch(src, /path\.join\(this\.path, 'spec\.md'\)/,
      'bootstrap preview should not read spec.md from the repo root');
    assert.doesNotMatch(src, /path\.join\(this\.path, 'roadmap\.md'\)/,
      'bootstrap preview should not read roadmap.md from the repo root');
    assert.match(src, /path\.join\(this\.knowledgeDir, 'spec\.md'\)/,
      'bootstrap preview should read spec.md from private knowledge dir');
    assert.match(src, /path\.join\(this\.knowledgeDir, 'roadmap\.md'\)/,
      'bootstrap preview should read roadmap.md from private knowledge dir');
  });

  it('startup/bootstrap should create the private knowledge directory', () => {
    const src = read(serverPath);
    assert.match(src, /'knowledge'/,
      'Expected startup/bootstrap logic to create a knowledge directory');
  });

  it('Athena prompt should point spec/roadmap to the private knowledge base, not project root', () => {
    const athena = read(athenaPath);
    assert.doesNotMatch(athena, /project root/i,
      'Athena should not be told to maintain spec/roadmap in the project root');
    assert.doesNotMatch(athena, /git add roadmap\.md && git commit -m "Update roadmap" && git push/,
      'Athena should not be told to commit/push roadmap changes');
    assert.match(athena, /knowledge base|knowledge\/spec\.md|knowledge\/roadmap\.md/i,
      'Athena should be told to use the private knowledge base');
  });

  it('repo-root spec and roadmap should no longer be canonical planning artifacts', () => {
    const src = read(serverPath);
    assert.doesNotMatch(src, /Read spec\.md and check roadmap\.md from project repo/,
      'server.js comments should not describe repo-root planning files as canonical');
  });
});
