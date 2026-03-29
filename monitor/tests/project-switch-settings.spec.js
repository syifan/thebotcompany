// @ts-check
import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_ID, MOCK_PROJECT } from './helpers.js'

const PROJECT_B = 'testowner/testrepo-b'

test.describe('Settings panel on project switch', () => {
  test('project settings panel should close when switching projects', async ({ page }) => {
    // Setup mocks for project A
    await setupMocks(page)

    // Add project B to status
    await page.route('**/api/status', route =>
      route.fulfill({ json: { uptime: 100, projectCount: 2, projects: [
        MOCK_PROJECT(),
        MOCK_PROJECT({ id: PROJECT_B, repo: PROJECT_B, path: `/tmp/${PROJECT_B}/repo` }),
      ] } })
    )

    // Mock project B routes
    const projBBase = `**/api/projects/${PROJECT_B}`
    await page.route(`${projBBase}/agents`, route => route.fulfill({ json: { managers: [], workers: [] } }))
    await page.route(`${projBBase}/config`, route => route.fulfill({ json: { config: { cycleIntervalMs: 0, agentTimeoutMs: 600000, model: 'mid', budgetPer24h: 100 } } }))
    await page.route(`${projBBase}/reports*`, route => route.fulfill({ json: { reports: [], total: 0, page: 1, perPage: 10 } }))
    await page.route(`${projBBase}/logs*`, route => route.fulfill({ json: { logs: [] } }))
    await page.route(`${projBBase}/prs`, route => route.fulfill({ json: { prs: [] } }))
    await page.route(`${projBBase}/repo`, route => route.fulfill({ json: { url: `https://github.com/${PROJECT_B}` } }))
    await page.route(`${projBBase}/agent-log`, route => route.fulfill({ json: { running: false } }))
    await page.route(`${projBBase}/issues`, route => route.fulfill({ json: { issues: [] } }))
    await page.route(`${projBBase}/chats`, route => route.fulfill({ json: { sessions: [] } }))
    await page.route(`${projBBase}/bootstrap`, route => route.fulfill({ json: { available: true } }))

    // Navigate to project A
    await page.goto(`/github.com/${PROJECT_ID}`)
    await page.waitForLoadState('networkidle')

    // Click the Project Settings button (gear icon)
    const settingsButton = page.locator('button[title="Project Settings"]')
    await settingsButton.waitFor({ timeout: 5000 })
    await settingsButton.click()

    // Settings panel should be open
    await expect(page.getByRole('heading', { name: 'Project Settings' })).toBeAttached({ timeout: 5000 })

    // Switch to project B by clicking its tab (in-app navigation)
    const projectBTab = page.locator(`button:has-text("${PROJECT_B}")`)
    await projectBTab.waitFor({ timeout: 5000 })
    await projectBTab.click()
    await page.waitForTimeout(1000) // wait for panel close animation

    // Settings panel should be CLOSED after switching projects
    // Settings panel should be CLOSED
    await expect(page.getByRole('heading', { name: 'Project Settings' })).not.toBeAttached({ timeout: 5000 })
  })
})
