/**
 * Regression test: canonical Athena schedule blocks in the Agent Reports card
 * should render as a schedule card instead of disappearing into plain text.
 */
import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_PATH, PROJECT_REPO } from './helpers.js'

test('Agent Reports card renders canonical schedule blocks', async ({ page }) => {
  const projectId = PROJECT_REPO
  const athenaBody = `> ⏱ Started: 2026-04-11 15:06:15 | Ended: 2026-04-11 15:07:44 | Duration: 1m 28s

I scheduled Iris and Nova to review the repo.

<!-- SCHEDULE -->
[
  {
    "agent": "iris",
    "issue": 11,
    "title": "Review README for accuracy",
    "prompt": "Read the README and report issues."
  },
  {
    "agent": "nova",
    "issue": 12,
    "title": "Review tests for datetime edge cases",
    "prompt": "Review tests and report edge cases."
  }
]
<!-- /SCHEDULE -->`

  await setupMocks(page, { withAgent: false })

  await page.route(`**/api/projects/${projectId}/comments*`, route =>
    route.fulfill({ json: {
      comments: [
        {
          id: 33,
          cycle: 7,
          agent: 'athena',
          body: athenaBody,
          created_at: '2026-04-11T19:07:44.106Z',
          summary: 'Iris and Nova agents analyze README and datetime tests.',
        },
      ],
      total: 1,
    } })
  )

  await page.route(`**/api/projects/${projectId}/reports*`, route =>
    route.fulfill({ json: {
      reports: [
        {
          id: 33,
          cycle: 7,
          agent: 'athena',
          body: athenaBody,
          created_at: '2026-04-11T19:07:44.106Z',
          summary: 'Iris and Nova agents analyze README and datetime tests.',
        },
      ],
      total: 1,
    } })
  )

  await page.goto(PROJECT_PATH)
  await page.waitForLoadState('networkidle')

  await expect(page.getByText(/Agent Reports/i)).toBeVisible()
  await expect(page.getByText(/Schedule · 2 agents/i)).toBeVisible()
})
