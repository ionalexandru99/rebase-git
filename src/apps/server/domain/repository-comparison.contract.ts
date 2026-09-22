export const previewByteLimit = 160_000;

export interface RepositoryFileContent {
  readonly content: Buffer | null;
  readonly bytes: number;
  readonly mode: string;
  readonly identity: string;
}
