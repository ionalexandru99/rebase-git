import { describe, expect, it } from 'vitest'
import { searchSettingsIndex, settingsSearchIndex } from '../search-index'

const rowIds = (query: string, repositoryOpen = true): string[] =>
  searchSettingsIndex(query, { repositoryOpen }).map((entry) => entry.rowId)

describe('searchSettingsIndex', () => {
  it('indexes every registered settings row exactly once', () => {
    const ids = settingsSearchIndex.map((entry) => entry.rowId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([
      'settings-general-reopen-on-launch',
      'settings-general-pull-diverged',
      'settings-identity-app',
      'settings-identity-repository',
      'settings-updates-version',
      'settings-updates-channel',
      'settings-updates-background-download',
      'settings-updates-install-on-quit',
      'settings-about-build',
      'settings-about-logs',
      'settings-about-release-notes'
    ])
  })

  it('finds a row by its title', () => {
    expect(rowIds('reopen repositories')).toEqual(['settings-general-reopen-on-launch'])
  })

  it('finds a row by its description', () => {
    expect(rowIds('bug reports')).toEqual(['settings-about-build'])
  })

  it('finds a row by its section label', () => {
    expect(rowIds('about')).toEqual([
      'settings-about-build',
      'settings-about-logs',
      'settings-about-release-notes'
    ])
  })

  it.each(['nightly', 'beta', 'prerelease'])('finds the update channel row for "%s"', (query) => {
    expect(rowIds(query)).toContain('settings-updates-channel')
  })

  it('matches case-insensitively', () => {
    expect(rowIds('NIGHTLY')).toContain('settings-updates-channel')
  })

  it('offers the repository identity row while a repository is open', () => {
    expect(rowIds('override')).toContain('settings-identity-repository')
  })

  it('hides the repository identity row when no repository is open', () => {
    expect(rowIds('override', false)).not.toContain('settings-identity-repository')
    expect(rowIds('local', false)).not.toContain('settings-identity-repository')
    expect(rowIds('Repository settings', false)).toEqual([])
  })

  it('returns nothing for a query no entry mentions', () => {
    expect(rowIds('kubernetes')).toEqual([])
  })

  it('returns nothing for a blank query', () => {
    expect(rowIds('')).toEqual([])
    expect(rowIds('   ')).toEqual([])
  })
})
