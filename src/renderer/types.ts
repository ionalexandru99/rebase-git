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

// Transitional shape for the open-repo handler — still uses the legacy
// success/error ADT. Replaced by OpenRepoResponse from @shared/schemas/ipc
// once that handler is ported.
import type { RepoOpenSuccess } from '@shared/schemas/git'
export type RepoOpenResult = RepoOpenSuccess & { success: boolean; error?: string }
