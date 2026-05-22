// Renderer-facing type aliases. The source-of-truth schemas live in
// src/shared/schemas/git.ts and are validated at every IPC boundary.
export type {
  GitBranches,
  GitLog,
  GitLogEntry,
  GitStatus,
  RenamedFile,
  RepoOpenSuccess
} from '@shared/schemas/git'
