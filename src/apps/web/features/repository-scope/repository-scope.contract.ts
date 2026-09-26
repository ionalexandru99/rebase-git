export interface RepositoryScope {
  readonly repositoryId: string;
  readonly worktreePath: string;
  readonly logicalRepositoryId: string;
  readonly connected: boolean;
  readonly readable: boolean;
  readonly writable: boolean;
}
