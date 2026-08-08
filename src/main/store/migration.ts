export interface WorkspaceMigration {
  workspaces?: string[]
  activeWorkspace?: string
}

export function planLegacyWorkspaceMigration(
  workspaces: string[],
  legacyWorkingDirectory: string | null,
  activeWorkspace: string | null
): WorkspaceMigration {
  if (workspaces.length > 0 || !legacyWorkingDirectory) {
    return {}
  }
  if (activeWorkspace) {
    return { workspaces: [legacyWorkingDirectory] }
  }
  return { workspaces: [legacyWorkingDirectory], activeWorkspace: legacyWorkingDirectory }
}

export function migrateReopenRepositoriesOnLaunch(storedValue: unknown): boolean {
  if (typeof storedValue === 'boolean') {
    return storedValue
  }
  return true
}
