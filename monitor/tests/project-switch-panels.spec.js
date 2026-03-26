// @ts-check
import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_ID, MOCK_PROJECT } from './helpers.js'

const PROJECT_B = 'testowner/testrepo-b'

test.describe('Panels close on project switch', () => {
  test('issue detail panel closes when navigating away', async ({ page }) => {
    // Setup mocks for project A (default from helpers)
    await setupMocks(page)

    // Also mock issues for project A
    await page.route(`**/api/projects/${PROJECT_ID}/issues`, route =>
      route.fulfill({ json: { issues: [
        { id: 1, title: 'Fix parser bug', status: 'open', creator: 'ares', assignee: 'felix', created_at: '2026-03-20T00:00:00Z' },
      ] } })
    )
    await page.route(`**/api/projects/${PROJECT_ID}/issues/1`, route =>
      route.fulfill({ json: {
        issue: { id: 1, title: 'Fix parser bug', status: 'open', creator: 'ares', assignee: 'felix', body: 'Parser fails on edge case', created_at: '2026-03-20T00:00:00Z' },
        comments: [{ id: 1, author: 'ares', body: 'Found the root cause', created_at: '2026-03-20T01:00:00Z' }]
      } })
    )

    // Add project B to the status response
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

    // Click on the issue to open the detail panel
    const issueLink = page.locator('text=Fix parser bug').first()
    await issueLink.waitFor({ timeout: 5000 })
    await issueLink.click()

    // Issue detail panel should be visible (heading with issue title)
    await expect(page.locator('h2:has-text("#1 Fix parser bug")').first()).toBeVisible({ timeout: 5000 })

    // Navigate to project B
    await page.goto(`/github.com/${PROJECT_B}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500) // let React re-render

    // Issue detail panel from project A should be closed
    await expect(page.locator('h2:has-text("#1 Fix parser bug")').first()).not.toBeVisible({ timeout: 3000 })
  })
})
