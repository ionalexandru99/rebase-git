import type { GitLogEntry } from '@/types'
import type { LayoutResult } from './layout'

export interface GraphLayoutWorkerRequest {
  generation: number
  commits: GitLogEntry[]
  hiddenParents: string[]
}

export interface GraphLayoutWorkerResponse {
  generation: number
  layout: LayoutResult
}
