import { test } from '@playwright/test'
import { setupMocks, PROJECT_PATH, PROJECT_REPO } from './helpers.js'

test('debug live entry', async ({ page }) => {
  await setupMocks(page, { withAgent: true })

  // Log all API requests
  page.on('request', req => {
    if (req.url().includes('/api/')) {
      console.log('REQ:', req.method(), req.url().replace('http://localhost:5174', ''))
    }
  })
  page.on('response', async resp => {
    if (resp.url().includes('/api/')) {
      const url = resp.url().replace('http://localhost:5174', '')
      if (url.includes('agent-log') || url.includes('status')) {
        const body = await resp.json().catch(() => ({}))
        console.log('RES:', url, JSON.stringify(body).slice(0, 200))
      }
    }
  })

  await page.goto(PROJECT_PATH)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(5000)

  const sidebar = await page.locator('[data-report-id]').allTextContents()
  console.log('Sidebar entries:', sidebar)
})
