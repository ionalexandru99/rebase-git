import { describe, expect, it } from 'vitest'
import { migrateReopenRepositoriesOnLaunch, planLegacyWorkspaceMigration } from '../migration'

describe('planLegacyWorkspaceMigration', () => {
  it('promotes the legacy working directory into an empty workspace list', () => {
    expect(planLegacyWorkspaceMigration([], '/repo', null)).toEqual({
      workspaces: ['/repo'],
      activeWorkspace: '/repo'
    })
  })

  it('leaves a populated workspace list untouched', () => {
    expect(planLegacyWorkspaceMigration(['/a'], '/repo', null)).toEqual({})
  })

  it('does nothing when there is no legacy working directory', () => {
    expect(planLegacyWorkspaceMigration([], null, null)).toEqual({})
  })

  it('keeps an existing active workspace when migrating the legacy directory', () => {
    expect(planLegacyWorkspaceMigration([], '/repo', '/other')).toEqual({
      workspaces: ['/repo']
    })
  })
})

describe('migrateReopenRepositoriesOnLaunch', () => {
  it('turns the preference on for configs written before the key existed', () => {
    expect(migrateReopenRepositoriesOnLaunch(undefined)).toBe(true)
  })

  it('keeps a stored opt-out', () => {
    expect(migrateReopenRepositoriesOnLaunch(false)).toBe(false)
  })

  it('keeps a stored opt-in', () => {
    expect(migrateReopenRepositoriesOnLaunch(true)).toBe(true)
  })

  it('falls back to on when the stored value is not a boolean', () => {
    expect(migrateReopenRepositoriesOnLaunch('yes')).toBe(true)
  })
})
