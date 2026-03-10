/**
 * Shared mock setup for TBC Playwright tests.
 * Mocks all required API endpoints so tests run without a real backend.
 */

export const PROJECT_ID = 'test-project-1'
export const PROJECT_REPO = 'syifan/thebotcompany'
export const PROJECT_PATH = `/github.com/${PROJECT_REPO}`

export const MOCK_PROJECT = {
  id: PROJECT_ID,
  repo: PROJECT_REPO,
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

export const makeLogEntries = (count) =>
  Array.from({ length: count }, (_, i) => ({
    time: Date.now() - (count - i) * 1000,
    msg: `Tool: Bash → echo "step ${i + 1}" # a longer command to ensure log box becomes scrollable with enough content here`,
  }))

/**
 * Sets up standard API mocks. Call before page.goto().
 * Returns helpers to update dynamic responses.
 */
export async function setupMocks(page, { withAgent = false } = {}) {
  let agentLogResponse = withAgent
    ? { running: true, agent: 'ares', model: 'claude-sonnet-4-6', startTime: new Date(Date.now() - 60000).toISOString(), log: makeLogEntries(20) }
    : { running: false, agent: null, model: null, startTime: null, log: [] }

  let projectStatus = withAgent
    ? { ...MOCK_PROJECT, currentAgent: 'ares', running: true }
    : { ...MOCK_PROJECT }

  // Auth — must return authenticated:true so write-mode buttons (Bootstrap) are visible
  await page.route('/api/auth', route =>
    route.fulfill({ json: { authenticated: true, passwordRequired: false } })
  )

  await page.route('/api/status', route =>
    route.fulfill({ json: { projects: [projectStatus] } })
  )

  await page.route('/api/settings', route =>
    route.fulfill({ json: { anthropicToken: 'test-token', openaiToken: null, googleToken: null, codexTokens: {} } })
  )

  await page.route('/api/settings/token', route =>
    route.fulfill({ json: { token: 'test-token' } })
  )

  await page.route(`/api/projects/${PROJECT_ID}/status`, route =>
    route.fulfill({ json: () => projectStatus })
  )

  await page.route(`/api/projects/${PROJECT_ID}/agent-log`, route =>
    route.fulfill({ json: () => agentLogResponse })
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
      route.fulfill({ json: { available: true, hasRoadmap: false, specContent: '', workspaceEmpty: false, repo: PROJECT_REPO } })
    } else {
      route.fulfill({ json: { success: true } })
    }
  })

  await page.route('/api/github/**', route => route.fulfill({ json: [] }))

  // Catch-all for any other API routes
  await page.route('/api/**', route => route.fulfill({ json: {} }))

  return {
    setAgentLog: (entries) => {
      agentLogResponse = {
        running: true,
        agent: 'ares',
        model: 'claude-sonnet-4-6',
        startTime: new Date(Date.now() - 60000).toISOString(),
        log: entries,
      }
      projectStatus = { ...MOCK_PROJECT, currentAgent: 'ares', running: true }
    },
    clearAgentLog: () => {
      agentLogResponse = { running: false, agent: null, model: null, startTime: null, log: [] }
      projectStatus = { ...MOCK_PROJECT }
    },
  }
}
