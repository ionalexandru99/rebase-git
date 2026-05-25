import type { ChildProcess } from 'node:child_process'
import type { SimpleGit } from 'simple-git'
import { fetchSemaphoreFor, fetchSemaphoreSize, releaseFetchSemaphore } from './fetch-semaphore'

export const gitInstances = new Map<string, SimpleGit>()
export const activeFetches = new Map<string, ChildProcess>()

export { fetchSemaphoreFor, fetchSemaphoreSize, releaseFetchSemaphore }
