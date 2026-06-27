import { expect, test } from './fixtures'

test('theme toggle flips the html dark class and the button label', async ({ harness }) => {
  await harness.seed({ onboardingComplete: true, tabs: [null], activeIndex: 0 })
  await harness.page.evaluate(() => {
    try {
      localStorage.setItem('theme', 'dark')
    } catch {}
  })
  const page = await harness.relaunch()

  const html = page.locator('html')
  await expect(html).toHaveClass(/dark/)
  const switchToLight = page.getByRole('button', { name: 'Switch to light theme' })
  await expect(switchToLight).toBeVisible({ timeout: 10_000 })

  await switchToLight.click()

  await expect(html).not.toHaveClass(/dark/)
  const switchToDark = page.getByRole('button', { name: 'Switch to dark theme' })
  await expect(switchToDark).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('theme')), { timeout: 10_000 }).toBe(
    'light'
  )

  await switchToDark.click()

  await expect(html).toHaveClass(/dark/)
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible({
    timeout: 10_000
  })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('theme')), { timeout: 10_000 }).toBe(
    'dark'
  )
})
