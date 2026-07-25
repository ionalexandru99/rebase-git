import { describe, expect, it } from 'vitest'
import { planLegacyWorkspaceMigration } from '../migration'

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
