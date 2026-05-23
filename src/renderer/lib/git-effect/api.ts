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
import { Effect } from 'effect'

const decodeIPCError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error))

export const openRepo = (path: string) =>
  Effect.tryPromise({
    try: () => window.electronAPI.openRepo(path),
    catch: decodeIPCError
  }).pipe(Effect.map((response) => decodeOrThrow(OpenRepoResponse, response)))

export const getStatus = (path: string) =>
  Effect.tryPromise({
    try: () => window.electronAPI.getStatus(path),
    catch: decodeIPCError
  }).pipe(Effect.map((response) => decodeOrThrow(StatusResponse, response)))

export const getBranches = (path: string) =>
  Effect.tryPromise({
    try: () => window.electronAPI.getBranches(path),
    catch: decodeIPCError
  }).pipe(Effect.map((response) => decodeOrThrow(BranchesResponse, response)))

export const getLog = (path: string) =>
  Effect.tryPromise({
    try: () => window.electronAPI.getLog(path),
    catch: decodeIPCError
  }).pipe(Effect.map((response) => decodeOrThrow(LogResponse, response)))

export const startLogStream = (path: string) =>
  Effect.tryPromise({
    try: () => window.electronAPI.startLogStream(path),
    catch: decodeIPCError
  }).pipe(Effect.map((response) => decodeOrThrow(StartLogStreamResponse, response)))

export const stageFile = (path: string, file: string) =>
  Effect.tryPromise({
    try: () => window.electronAPI.stageFile(path, file),
    catch: decodeIPCError
  }).pipe(Effect.map((response) => decodeOrThrow(StageResponse, response)))

export const unstageFile = (path: string, file: string) =>
  Effect.tryPromise({
    try: () => window.electronAPI.unstageFile(path, file),
    catch: decodeIPCError
  }).pipe(Effect.map((response) => decodeOrThrow(UnstageResponse, response)))

export const commit = (path: string, message: string) =>
  Effect.tryPromise({
    try: () => window.electronAPI.commit(path, message),
    catch: decodeIPCError
  }).pipe(Effect.map((response) => decodeOrThrow(CommitResponse, response)))

export const fetchRepo = (path: string) =>
  Effect.tryPromise({
    try: () => window.electronAPI.fetchRepo(path),
    catch: decodeIPCError
  }).pipe(Effect.map((response) => decodeOrThrow(FetchResponse, response)))
