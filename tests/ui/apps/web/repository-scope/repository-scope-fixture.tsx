import type { RepositoryScope } from "#web/features/repository-scope/index";

export function repositoryScope(
  scope: Partial<RepositoryScope> = {},
): RepositoryScope {
  return {
    repositoryId: "00000000-0000-4000-8000-000000000001",
    worktreePath: "/repo",
    refs: {
      apply: () => undefined,
      checkout: async () => {
        throw new Error("Unexpected checkout");
      },
    },
    connected: true,
    readable: true,
    writable: true,
    ...scope,
  };
}
