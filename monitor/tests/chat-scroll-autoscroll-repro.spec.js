import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_PATH, PROJECT_REPO } from './helpers.js'

const CHAT_ID = 'chat-1'

function makeMessages(count) {
  const messages = []
  for (let i = 1; i <= count; i++) {
    messages.push({ role: 'user', content: `Question ${i}` })
    messages.push({ role: 'assistant', content: `Answer ${i} `.repeat(12) })
  }
  return messages
}

test('chat panel should not jump to bottom while reading older messages', async ({ page }) => {
  await setupMocks(page)

  let pollCount = 0
  const baseMessages = makeMessages(30)

  await page.route(`**/api/projects/${PROJECT_REPO}/chats`, route =>
    route.fulfill({
      json: {
        sessions: [
          {
            id: CHAT_ID,
            title: 'Scroll repro',
            updated_at: new Date().toISOString(),
            message_count: baseMessages.length,
          },
        ],
      },
    })
  )

  await page.route(`**/api/projects/${PROJECT_REPO}/chats/${CHAT_ID}`, route => {
    pollCount++
    route.fulfill({
      json: {
        session: {
          id: CHAT_ID,
          title: 'Scroll repro',
          messages: baseMessages,
        },
        streaming: false,
      },
    })
  })

  await page.goto(`${PROJECT_PATH}/chat/${CHAT_ID}`)
  await page.waitForLoadState('networkidle')

  await expect(page.locator('button[aria-label="Send"]').last()).toBeVisible({ timeout: 5000 })

  const container = page.locator('.h-full.overflow-y-auto.overflow-x-hidden.p-4.space-y-1.overscroll-contain').last()
  await expect(container).toBeVisible({ timeout: 5000 })

  await expect.poll(async () => {
    const dims = await container.evaluate(el => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
    return dims.scrollHeight > dims.clientHeight
  }).toBe(true)

  await container.evaluate(el => {
    el.scrollTop = 0
    el.dispatchEvent(new Event('scroll'))
  })
  await page.waitForTimeout(300)

  const before = await container.evaluate(el => el.scrollTop)
  expect(before).toBe(0)

  const pollsBefore = pollCount
  await page.waitForTimeout(7000)
  expect(pollCount).toBeGreaterThan(pollsBefore)

  const after = await container.evaluate(el => el.scrollTop)

  expect(after).toBeLessThan(20)
})
