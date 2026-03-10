/**
 * Shared mock setup for TBC Playwright tests.
 * NOTE: Playwright routes use LIFO order — later-registered routes take precedence.
 * Register catch-all FIRST, then specific routes.
 */

export const PROJECT_REPO = 'testowner/testrepo'
export const PROJECT_ID = PROJECT_REPO
export const PROJECT_PATH = `/github.com/${PROJECT_REPO}`

const MOCK_AGENT = (name, role, isManager = false) => ({
  name, role, model: 'mid', rawModel: 'mid', isManager,
  totalCost: 1.0, last24hCost: 0, lastCallCost: 0.1, avgCallCost: 0.1, callCount: 10,
})

export const MOCK_PROJECT = (overrides = {}) => ({
  id: PROJECT_ID,
  path: '/tmp/test-project/repo',
  repo: PROJECT_REPO,
  enabled: true,
  archived: false,
  running: false,
  paused: false,
  pauseReason: null,
  cycleCount: 5,
  currentAgent: null,
  currentAgentModel: null,
  currentAgentRuntime: null,
  sleeping: false,
  sleepUntil: null,
  schedule: null,
  phase: 'execution',
  milestoneTitle: 'Test Milestone',
  milestone: 'Test Milestone: A test milestone',
  milestoneCyclesBudget: 10,
  milestoneCyclesUsed: 3,
  isFixRound: false,
  isComplete: false,
  completionSuccess: false,
  completionMessage: null,
  config: { cycleIntervalMs: 0, agentTimeoutMs: 600000, model: 'mid', budgetPer24h: 100, trackerIssue: null },
  agents: { managers: [MOCK_AGENT('athena', 'Planning Manager', true)], workers: [MOCK_AGENT('ares', 'Execution Worker')] },
  cost: { totalCost: 5.0, last24hCost: 1.0, lastCycleCost: 0.5, avgCycleCost: 0.5 },
  budget: { budgetPer24h: 100, spent24h: 1.0, percentUsed: 1.0 },
  ...overrides,
})

export const makeLogEntries = (count) =>
  Array.from({ length: count }, (_, i) => ({
    time: Date.now() - (count - i) * 1000,
    msg: `Tool: Bash → echo "step ${i + 1}" # a longer command to fill the log box`,
  }))

export async function setupMocks(page, { withAgent = false } = {}) {
  let currentAgent = withAgent ? 'ares' : null
  let logEntries = withAgent ? makeLogEntries(20) : []

  const getProject = () => MOCK_PROJECT({ currentAgent, running: !!currentAgent })
  const projBase = `**/api/projects/${PROJECT_REPO}`

  // ---- CATCH-ALL FIRST (Playwright LIFO: later routes win) ----
  await page.route('**/api/**', route => route.fulfill({ json: {} }))

  // ---- SPECIFIC ROUTES (registered after catch-all, so they take precedence) ----

  // Global
  await page.route('**/api/auth', route =>
    route.fulfill({ json: { authenticated: true, passwordRequired: false } })
  )
  await page.route('**/api/status', route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ uptime: 100, projectCount: 1, projects: [getProject()] }) })
  )
  await page.route('**/api/settings', route =>
    route.fulfill({ json: { anthropicToken: 'test-token', openaiToken: null, googleToken: null, codexTokens: {} } })
  )
  await page.route('**/api/settings/token', route =>
    route.fulfill({ json: { token: 'test-token' } })
  )
  await page.route('**/api/models', route =>
    route.fulfill({ json: { models: [] } })
  )
  await page.route('**/api/notifications', route =>
    route.fulfill({ json: { notifications: [], unread: 0 } })
  )
  await page.route('**/api/openai-codex/status', route =>
    route.fulfill({ json: { authenticated: false } })
  )

  // Project-scoped
  await page.route(`${projBase}/status`, route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(getProject()) })
  )
  await page.route(`${projBase}/agent-log`, route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(currentAgent
        ? { running: true, agent: 'ares', model: 'claude-sonnet-4-6', startTime: new Date(Date.now() - 60000).toISOString(), log: logEntries }
        : { running: false, agent: null, model: null, startTime: null, log: [] })
    })
  )
  await page.route(`${projBase}/agents`, route =>
    route.fulfill({ json: { managers: [MOCK_AGENT('athena', 'Planning Manager', true)], workers: [MOCK_AGENT('ares', 'Execution Worker')] } })
  )
  await page.route(`${projBase}/comments*`, route =>
    route.fulfill({ json: { comments: [], total: 0 } })
  )
  await page.route(`${projBase}/prs`, route =>
    route.fulfill({ json: [] })
  )
  await page.route(`${projBase}/logs*`, route =>
    route.fulfill({ json: { logs: ['[test] Server started'] } })
  )
  await page.route(`${projBase}/config`, route =>
    route.fulfill({ json: { agentTimeoutMs: 600000, intervalMs: 30000, budget24h: 10, hasProjectToken: false, config: { cycleIntervalMs: 0, agentTimeoutMs: 600000, model: 'mid', budgetPer24h: 100 } } })
  )
  await page.route(`${projBase}/reports*`, route =>
    route.fulfill({ json: [] })
  )
  await page.route(`${projBase}/issues`, route =>
    route.fulfill({ json: [] })
  )
  await page.route(`${projBase}/repo`, route =>
    route.fulfill({ json: { repoUrl: `https://github.com/${PROJECT_REPO}` } })
  )
  await page.route(`${projBase}/bootstrap`, route => {
    if (route.request().method() === 'GET') {
      route.fulfill({ json: { available: true, hasRoadmap: false, specContent: '', workspaceEmpty: false, repo: PROJECT_REPO } })
    } else {
      route.fulfill({ json: { success: true } })
    }
  })

  return {
    setAgentLog: (entries) => { currentAgent = 'ares'; logEntries = entries },
    clearAgentLog: () => { currentAgent = null; logEntries = [] },
  }
}
