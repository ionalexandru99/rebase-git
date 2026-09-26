import type { RepositoryRefsController } from "#web/features/repository-refs/index";

export interface RepositoryScope {
  readonly repositoryId: string;
  readonly worktreePath: string;
  readonly logicalRepositoryId?: string;
  readonly refs: Pick<RepositoryRefsController, "apply" | "checkout">;
  readonly connected: boolean;
  readonly readable: boolean;
  readonly writable: boolean;
}
