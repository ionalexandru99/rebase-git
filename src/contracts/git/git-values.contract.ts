import { z } from "zod";

export const RepositoryId = z.uuidv4();
export type RepositoryId = z.infer<typeof RepositoryId>;

export const ObjectId = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
export type ObjectId = z.infer<typeof ObjectId>;
export const isObjectId = (value: unknown): value is ObjectId =>
  ObjectId.safeParse(value).success;

export const RepositoryPath = z.string().min(1).max(4_096);
export type RepositoryPath = z.infer<typeof RepositoryPath>;

export const RemoteUrl = z
  .string()
  .max(4_096)
  .regex(/^[^\s-]\S*$/);
export type RemoteUrl = z.infer<typeof RemoteUrl>;

export const RefName = z.string().min(1).max(1_024);
export type RefName = z.infer<typeof RefName>;

export const RemoteName = z.string().min(1).max(255);
export type RemoteName = z.infer<typeof RemoteName>;

export const WorktreeScope = z.object({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
});
export type WorktreeScope = z.infer<typeof WorktreeScope>;
