export interface RepositoryFilesystem {
  revealRepository(path: string): Promise<void>;
}

export interface RepositoryFilesystemPlatform {
  showItemInFolder(path: string): void;
}
