import type { ChildProcess } from 'node:child_process'
import { fetchSemaphoreFor, fetchSemaphoreSize, releaseFetchSemaphore } from './fetch-semaphore'

export const activeFetches = new Map<string, ChildProcess>()
export const commitGraphWrites = new Map<string, ChildProcess>()

export { fetchSemaphoreFor, fetchSemaphoreSize, releaseFetchSemaphore }
