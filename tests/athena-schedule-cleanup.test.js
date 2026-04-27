import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const server = fs.readFileSync(path.resolve('src/orchestrator/phase-machine.js'), 'utf8')

describe('athena schedule cleanup', () => {
  it('clears currentSchedule and completedAgents after an Athena worker schedule finishes', () => {
    const athenaBlock = server.match(/if \(runner\.phase === 'athena'\) \{[\s\S]*?\n      \}\n\n      \/\/ ===== PHASE: IMPLEMENTATION/)
    assert.ok(athenaBlock, 'Athena phase block not found')
    const block = athenaBlock[0]
    assert.match(block, /await runner\.executeSchedule\(schedule, config, 'athena'\);[\s\S]*runner\.currentSchedule = null;/)
    assert.match(block, /await runner\.executeSchedule\(schedule, config, 'athena'\);[\s\S]*runner\.completedAgents = \[\];/)
  })
})
