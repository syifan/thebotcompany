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

describe('private knowledge base for spec, roadmap, and internal analysis docs', () => {
  it('defines a shared knowledge-base path outside the repo root', () => {
    const src = read(serverPath);
    assert.match(src, /get knowledgeDir\(\)/, 'Expected a knowledgeDir getter in server.js');
    assert.match(src, /path\.join\(this\.projectDir, 'knowledge'\)/,
      'Expected knowledge base to live under project knowledge/, not the repo root');
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

  it('startup/bootstrap should create the private knowledge directory and subfolders for internal docs', () => {
    const src = read(serverPath);
    assert.match(src, /'knowledge'/,
      'Expected startup/bootstrap logic to create a knowledge directory');
    assert.match(src, /knowledge', 'analysis'|path\.join\('knowledge', 'analysis'\)|'knowledge\/analysis'/,
      'Expected a private analysis subdirectory under knowledge/');
    assert.match(src, /knowledge', 'decisions'|path\.join\('knowledge', 'decisions'\)|'knowledge\/decisions'/,
      'Expected a private decisions subdirectory under knowledge/');
  });

  it('Athena prompt should point planning and internal analysis docs to the private knowledge base, not the repo', () => {
    const athena = read(athenaPath);
    assert.doesNotMatch(athena, /project root/i,
      'Athena should not be told to maintain planning docs in the project root');
    assert.doesNotMatch(athena, /git add roadmap\.md && git commit -m "Update roadmap" && git push/,
      'Athena should not be told to commit/push roadmap changes');
    assert.match(athena, /knowledge base|knowledge\/spec\.md|knowledge\/roadmap\.md/i,
      'Athena should be told to use the private knowledge base');
    assert.match(athena, /knowledge\/analysis|knowledge\/decisions|internal analysis/i,
      'Athena should be told to keep internal analysis docs in the private knowledge base');
    assert.match(athena, /Do not treat `repo\/docs\/` as the default home for internal analysis/i,
      'Athena should be explicitly told not to use repo docs as the default home for internal analysis');
  });

  it('repo-root spec/roadmap and internal analysis docs should no longer be canonical private artifacts', () => {
    const src = read(serverPath);
    assert.doesNotMatch(src, /Read spec\.md and check roadmap\.md from project repo/,
      'server.js comments should not describe repo-root planning files as canonical');
  });
});
