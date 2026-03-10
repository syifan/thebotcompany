/**
 * Shared mock setup for TBC Playwright tests.
 * Mocks all required API endpoints so tests run without a real backend.
 */

export const PROJECT_ID = 'test-project'

export const MOCK_PROJECT = {
  id: PROJECT_ID,
  repo: 'syifan/thebotcompany',
  enabled: true,
  archived: false,
  running: false,
  paused: false,
  pauseReason: null,
  cycleCount: 5,
  currentAgent: null,
  currentAgentModel: null,
  currentAgentStartTime: null,
  phase: 'execution',
  milestone: { title: 'Test Milestone', description: 'A test milestone' },
  cyclesBudget: 10,
  cyclesUsed: 3,
}

export const MOCK_AGENT_LOG = (entries = []) => ({
  running: true,
  agent: 'ares',
  model: 'claude-sonnet-4-6',
  startTime: new Date(Date.now() - 60000).toISOString(),
  log: entries,
})

/**
 * Sets up standard API mocks. Call in beforeEach or at the start of a test.
 * Returns helpers to update dynamic responses (e.g. log entries).
 */
export async function setupMocks(page) {
  let agentLogResponse = { running: false, agent: null, model: null, startTime: null, log: [] }
  let projectStatus = { ...MOCK_PROJECT }

  await page.route('/api/auth', route =>
    route.fulfill({ json: { authenticated: true, passwordRequired: false } })
  )

  await page.route('/api/status', route =>
    route.fulfill({ json: { projects: [projectStatus] } })
  )

  await page.route('/api/settings', route =>
    route.fulfill({ json: { anthropicToken: 'test-token', openaiToken: null, googleToken: null, codexTokens: {} } })
  )

  await page.route(`/api/projects/${PROJECT_ID}/status`, route =>
    route.fulfill({ json: projectStatus })
  )

  await page.route(`/api/projects/${PROJECT_ID}/agent-log`, route =>
    route.fulfill({ json: agentLogResponse })
  )

  await page.route(`/api/projects/${PROJECT_ID}/agents`, route =>
    route.fulfill({ json: [] })
  )

  await page.route(`/api/projects/${PROJECT_ID}/comments`, route =>
    route.fulfill({ json: { comments: [], total: 0 } })
  )

  await page.route(`/api/projects/${PROJECT_ID}/prs`, route =>
    route.fulfill({ json: [] })
  )

  await page.route(`/api/projects/${PROJECT_ID}/logs`, route =>
    route.fulfill({ json: { logs: [] } })
  )

  await page.route(`/api/projects/${PROJECT_ID}/config`, route =>
    route.fulfill({ json: { agentTimeoutMs: 600000, intervalMs: 30000, budget24h: 10 } })
  )

  await page.route(`/api/projects/${PROJECT_ID}/bootstrap`, async route => {
    if (route.request().method() === 'GET') {
      route.fulfill({ json: { available: true, hasRoadmap: false, specContent: '', workspaceEmpty: false, repo: 'syifan/thebotcompany' } })
    } else {
      route.fulfill({ json: { success: true } })
    }
  })

  // Catch-all for unmatched API routes
  await page.route('/api/**', route => route.fulfill({ json: {} }))

  return {
    setAgentLog: (entries) => {
      agentLogResponse = MOCK_AGENT_LOG(entries)
      projectStatus = { ...MOCK_PROJECT, currentAgent: 'ares', running: true }
    },
    clearAgentLog: () => {
      agentLogResponse = { running: false, agent: null, model: null, startTime: null, log: [] }
      projectStatus = { ...MOCK_PROJECT }
    },
  }
}
