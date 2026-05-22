import type { ChildProcess } from 'node:child_process'
import type { SimpleGit } from 'simple-git'

export const gitInstances = new Map<string, SimpleGit>()
export const activeFetches = new Map<string, ChildProcess>()
