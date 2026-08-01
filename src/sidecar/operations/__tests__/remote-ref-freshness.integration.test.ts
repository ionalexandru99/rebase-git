import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runOp } from '../../test-support/run-op'
import { closeRepo, getRemoteRefs, openRepo } from '../index'

const MAIN_COMMITTED_AT = '2022-06-07T08:09:10+00:00'
const FEATURE_COMMITTED_AT = '2021-01-02T03:04:05+00:00'
const TAGGED_COMMITTED_AT = '2020-03-04T05:06:07+00:00'
const ANNOTATED_TAG_CREATED_AT = '2023-09-09T09:09:09+00:00'

let remoteDir: string
let repoDir: string

function git(args: string[], committerDate?: string): string {
  return execFileSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf8',
    env: committerDate ? { ...process.env, GIT_COMMITTER_DATE: committerDate } : process.env
  })
}

function commit(message: string, committedAt: string): void {
  git(['-c', 'commit.gpgsign=false', 'commit', '--no-gpg-sign', '-m', message], committedAt)
}

beforeAll(async () => {
  const base = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-remote-freshness-'))
  )
  remoteDir = path.join(base, 'remote.git')
  repoDir = path.join(base, 'clone')
  fs.mkdirSync(remoteDir)
  execFileSync('git', ['-C', remoteDir, 'init', '--bare', '-b', 'main'])
  execFileSync('git', ['clone', remoteDir, repoDir])
  git(['config', 'user.email', 'author@example.com'])
  git(['config', 'user.name', 'Ada Author'])

  fs.writeFileSync(path.join(repoDir, 'tagged.txt'), 'tagged\n')
  git(['add', '-A'])
  commit('tagged commit', TAGGED_COMMITTED_AT)
  git(['tag', 'v1.0.0-light'])
  git(['tag', '-a', 'v1.0.0-annotated', '-m', 'release'], ANNOTATED_TAG_CREATED_AT)

  fs.writeFileSync(path.join(repoDir, 'main.txt'), 'main\n')
  git(['add', '-A'])
  commit('main commit', MAIN_COMMITTED_AT)
  git(['push', '--set-upstream', 'origin', 'main'])

  git(['checkout', '-q', '-b', 'feature'])
  fs.writeFileSync(path.join(repoDir, 'feature.txt'), 'feature\n')
  git(['add', '-A'])
  commit('feature commit', FEATURE_COMMITTED_AT)
  git(['push', '--set-upstream', 'origin', 'feature'])
  git(['checkout', '-q', 'main'])

  await runOp(openRepo(repoDir))
})

afterAll(async () => {
  await runOp(closeRepo(repoDir))
  fs.rmSync(path.dirname(repoDir), { recursive: true, force: true })
})

describe('remote ref freshness', () => {
  it('carries the tip committer date of every remote branch as an ISO string', async () => {
    const { refs } = await runOp(getRemoteRefs(repoDir))

    expect(refs.remotes).toContain('origin/main')
    expect(Date.parse(refs.remoteLastCommitAt?.['origin/main'] ?? '')).toBe(
      Date.parse(MAIN_COMMITTED_AT)
    )
    expect(Date.parse(refs.remoteLastCommitAt?.['origin/feature'] ?? '')).toBe(
      Date.parse(FEATURE_COMMITTED_AT)
    )
  })

  it('leaves symbolic remote refs out of the freshness map', async () => {
    const { refs } = await runOp(getRemoteRefs(repoDir))

    expect(Object.keys(refs.remoteLastCommitAt ?? {}).sort()).toEqual([
      'origin/feature',
      'origin/main'
    ])
  })

  it('carries the target commit date of a lightweight tag', async () => {
    const { refs } = await runOp(getRemoteRefs(repoDir))

    expect(Date.parse(refs.tagLastCommitAt?.['v1.0.0-light'] ?? '')).toBe(
      Date.parse(TAGGED_COMMITTED_AT)
    )
  })

  it('peels an annotated tag to its target commit date rather than the tag date', async () => {
    const { refs } = await runOp(getRemoteRefs(repoDir))

    expect(Date.parse(refs.tagLastCommitAt?.['v1.0.0-annotated'] ?? '')).toBe(
      Date.parse(TAGGED_COMMITTED_AT)
    )
    expect(Date.parse(refs.tagLastCommitAt?.['v1.0.0-annotated'] ?? '')).not.toBe(
      Date.parse(ANNOTATED_TAG_CREATED_AT)
    )
  })
})
