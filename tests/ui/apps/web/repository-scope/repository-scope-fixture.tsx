import type { RepositoryScope } from "#web/features/repository-scope/repository-scope-provider";

export function repositoryScope(
  scope: Partial<RepositoryScope> = {},
): RepositoryScope {
  return {
    repositoryId: "00000000-0000-4000-8000-000000000001",
    worktreePath: "/repo",
    logicalRepositoryId: "00000000-0000-4000-8000-000000000001",
    connected: true,
    readable: true,
    writable: true,
    switchWorktree: () => undefined,
    ...scope,
  };
}
