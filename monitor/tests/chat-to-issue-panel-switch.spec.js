// @ts-check
import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_PATH, PROJECT_REPO } from './helpers.js'

test.describe('Panel switching', () => {
  test('opening an issue while chat is open keeps the issue panel open', async ({ page }) => {
    await setupMocks(page)

    await page.route(`**/api/projects/${PROJECT_REPO}/issues`, route =>
      route.fulfill({
        json: {
          issues: [
            {
              id: 17,
              title: 'Agent issue after chat',
              status: 'open',
              creator: 'ares',
              assignee: 'athena',
              comment_count: 0,
              labels: '',
            },
          ],
        },
      })
    )

    await page.route(`**/api/projects/${PROJECT_REPO}/issues/17`, async route =>
      route.fulfill({
        json: {
          issue: {
            id: 17,
            title: 'Agent issue after chat',
            status: 'open',
            creator: 'ares',
            assignee: 'athena',
            comment_count: 0,
            labels: '',
            body: 'Issue body',
            created_at: '2026-04-12T10:00:00.000Z',
            closed_at: null,
          },
          comments: [],
        },
      })
    )

    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    await page.locator('button[title="New Chat"]').click()
    await expect(page.getByRole('heading', { name: /New Chat/ })).toBeVisible({ timeout: 5000 })

    await page.getByText('Agent issue after chat').click()

    await expect(page).toHaveURL(/\/issue\/17$/)
    await expect(page.getByRole('heading', { name: '#17 Agent issue after chat' })).toBeVisible({ timeout: 5000 })
  })
})
