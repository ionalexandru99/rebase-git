import { decodeOrThrow } from '@shared/codec'
import {
  BranchesResponse,
  CommitResponse,
  FetchResponse,
  LogResponse,
  OpenRepoResponse,
  StageResponse,
  StartLogStreamResponse,
  StatusResponse,
  UnstageResponse
} from '@shared/schemas/ipc'
import { Effect, type Schema } from 'effect'
import { GitClient } from '@/lib/git-client'

const decodeIPCError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error))

const sidecarOp = <A, I>(op: string, body: Record<string, unknown>, schema: Schema.Schema<A, I>) =>
  GitClient.pipe(
    Effect.flatMap((git) => git.request(op, body)),
    Effect.map((response) => decodeOrThrow(schema, response))
  )

export const openRepo = (path: string) =>
  Effect.tryPromise({
    try: () => window.electronAPI.openRepo(path),
    catch: decodeIPCError
  }).pipe(Effect.map((response) => decodeOrThrow(OpenRepoResponse, response)))

export const startLogStream = (path: string) =>
  Effect.tryPromise({
    try: () => window.electronAPI.startLogStream(path),
    catch: decodeIPCError
  }).pipe(Effect.map((response) => decodeOrThrow(StartLogStreamResponse, response)))

export const getStatus = (path: string) =>
  sidecarOp('get-status', { repoPath: path }, StatusResponse)

export const getBranches = (path: string) =>
  sidecarOp('get-branches', { repoPath: path }, BranchesResponse)

export const getLog = (path: string) => sidecarOp('get-log', { repoPath: path }, LogResponse)

export const stageFile = (path: string, file: string) =>
  sidecarOp('stage-file', { repoPath: path, file }, StageResponse)

export const unstageFile = (path: string, file: string) =>
  sidecarOp('unstage-file', { repoPath: path, file }, UnstageResponse)

export const commit = (path: string, message: string) =>
  sidecarOp('commit', { repoPath: path, message }, CommitResponse)

export const fetchRepo = (path: string) =>
  sidecarOp('fetch-repo', { repoPath: path }, FetchResponse)
