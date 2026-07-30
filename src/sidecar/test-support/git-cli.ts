import { execFileSync } from 'node:child_process'

export function makeGit(repoDir: string) {
  return (...args: string[]): string =>
    execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
}
