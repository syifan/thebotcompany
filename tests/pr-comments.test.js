import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const server = fs.readFileSync(path.resolve('src/server.js'), 'utf8')
const projectView = fs.readFileSync(path.resolve('monitor/src/components/layout/ProjectView.jsx'), 'utf8')
const prPanel = fs.readFileSync(path.resolve('monitor/src/components/panels/PRDetailPanel.jsx'), 'utf8')
const timeline = fs.readFileSync(path.resolve('monitor/src/components/ui/entity-event-list.jsx'), 'utf8')

describe('native PR comments', () => {
  it('adds backend storage and routes for TBC PR comments', () => {
    assert.match(server, /CREATE TABLE IF NOT EXISTS pr_comments/i)
    assert.match(server, /async addPRComment\(/)
    assert.match(server, /POST \/api\/projects\/:id\/prs\/:prId\/comments/)
  })

  it('loads and submits PR comments from the monitor', () => {
    assert.match(projectView, /submitPRComment/)
    assert.match(projectView, /projectApi\(`\/prs\/\$\{prModal\.pr\.id\}\/comments`\)/)
    assert.match(prPanel, /Post comment/)
    assert.match(timeline, /buildPRTimeline\(pr, comments = \[\]\)/)
  })
})
