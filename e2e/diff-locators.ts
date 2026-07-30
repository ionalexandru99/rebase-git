import type { Page } from '@playwright/test'

export const commitRow = (page: Page, subject: string) =>
  page.getByTestId('commit-row').filter({ hasText: subject })

export const detailsPanel = (page: Page) => page.getByTestId('commit-details-panel')

export const diffBody = (page: Page) => detailsPanel(page).getByTestId('diff-body')

export const diffLines = (page: Page) => diffBody(page).locator('[data-line]')

export const diffLine = (page: Page, text: string | RegExp) =>
  diffLines(page).filter({ hasText: text })

export const diffPre = (page: Page) => diffBody(page).locator('pre[data-diff]')

export const diffScrollHost = (page: Page) => diffBody(page).locator('.scroll-host')

export const styleButton = (page: Page, name: 'Unified' | 'Split') =>
  detailsPanel(page).getByRole('button', { name, exact: true })
