import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const server = fs.readFileSync(path.resolve('src/server.js'), 'utf8')
const projectView = fs.readFileSync(path.resolve('monitor/src/components/layout/ProjectView.jsx'), 'utf8')
const treeCard = fs.readFileSync(path.resolve('monitor/src/components/project/MilestoneTreeCard.jsx'), 'utf8')

describe('milestone tree widget', () => {
  it('exposes milestone records through the project API', () => {
    assert.match(server, /GET \/api\/projects\/:id\/milestones/)
    assert.match(server, /FROM milestones/)
    assert.match(server, /parent_milestone_id/)
  })

  it('loads milestones in ProjectView and renders the tree widget', () => {
    assert.match(projectView, /fetch\(`\$\{baseApi\}\/milestones`\)/)
    assert.match(projectView, /setMilestones\(/)
    assert.match(projectView, /<MilestoneTreeCard/)
  })

  it('renders a read-only nested milestone tree with status metadata', () => {
    assert.match(treeCard, /function buildTree/)
    assert.match(treeCard, /children: \[\]/)
    assert.match(treeCard, /Milestones \(\$\{milestones.length\}\)/)
    assert.match(treeCard, /currentMilestoneId/)
    assert.match(treeCard, /node\.linked_pr_id/)
  })

  it('shows recent milestones first, starts folded, and uses page scrolling like issues', () => {
    assert.match(treeCard, /compareMilestonesDesc/)
    assert.match(treeCard, /const \[open, setOpen\] = useState\(false\)/)
    assert.doesNotMatch(treeCard, /max-h-\[32rem\] overflow-y-auto/)
    assert.doesNotMatch(treeCard, /IntersectionObserver/)
  })
})
