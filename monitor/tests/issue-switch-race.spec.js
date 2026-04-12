// @ts-check
import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_ID } from './helpers.js'

test.describe('Issue detail loading', () => {
  test('switching issues does not duplicate requests or show stale issue content', async ({ page }) => {
    await setupMocks(page)

    const projBase = `**/api/projects/${PROJECT_ID}`
    const issues = [
      { id: 1, title: 'First issue', status: 'open', creator: 'ares', assignee: 'athena', comment_count: 0, labels: '' },
      { id: 2, title: 'Second issue', status: 'open', creator: 'ares', assignee: 'athena', comment_count: 0, labels: '' },
    ]
    await page.route(`${projBase}/issues`, route =>
      route.fulfill({ json: { issues } })
    )

    await page.route(`${projBase}/issues/*`, async route => {
      const issueId = Number(route.request().url().split('/').pop())
      await new Promise(resolve => setTimeout(resolve, issueId === 1 ? 250 : 25))
      await route.fulfill({
        json: {
          issue: {
            id: issueId,
            title: issueId === 1 ? 'First issue' : 'Second issue',
            status: 'open',
            creator: 'ares',
            assignee: 'athena',
            labels: '',
            body: `Body for issue ${issueId}`,
            created_at: '2026-04-12T10:00:00.000Z',
            closed_at: null,
          },
          comments: [],
        },
      })
    })

    await page.goto(`/github.com/${PROJECT_ID}`)
    await page.waitForLoadState('networkidle')

    await page.getByText('First issue').click()
    await page.getByText('Second issue').click()

    await expect(page.getByRole('heading', { name: '#2 Second issue' })).toBeAttached({ timeout: 5000 })
    await page.waitForTimeout(350)
    await expect(page.getByRole('heading', { name: '#2 Second issue' })).toBeAttached()
    await expect(page.getByText('Failed to load issue')).not.toBeVisible()
  })
})
