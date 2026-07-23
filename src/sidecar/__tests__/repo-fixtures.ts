import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function git(cwd: string, args: string[]): void {
  const base =
    args[0] === 'commit' ? ['-c', 'commit.gpgsign=false', 'commit', '--no-gpg-sign'] : args
  execFileSync('git', args[0] === 'commit' ? [...base, ...args.slice(1)] : base, {
    cwd,
    stdio: 'ignore'
  })
}

export function makeRepo(messages: string[]): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-stream-'))
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test'])
  for (const message of messages) {
    git(repo, ['commit', '--allow-empty', '-m', message])
  }
  return repo
}

// A linear history big enough to span many STREAM_BATCH_SIZE (500) chunks, so a stream is reliably
// still in-flight after its first chunk. fast-import builds it in one pass (a per-commit loop would be
// far too slow). Newest commit is `c${count}`; --topo-order yields newest-first.
export function makeBigRepo(count: number): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-rpc-stream-big-'))
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test'])
  const lines: string[] = []
  for (let index = 1; index <= count; index++) {
    const message = `c${index}`
    lines.push('commit refs/heads/main')
    lines.push(`mark :${index}`)
    lines.push(`committer Test <test@example.com> ${1700000000 + index} +0000`)
    lines.push(`data ${Buffer.byteLength(message)}`)
    lines.push(message)
    if (index > 1) {
      lines.push(`from :${index - 1}`)
    }
    const blob = `${index}`
    lines.push('M 644 inline file.txt')
    lines.push(`data ${Buffer.byteLength(blob)}`)
    lines.push(blob)
    lines.push('')
  }
  execFileSync('git', ['fast-import', '--quiet'], {
    cwd: repo,
    input: `${lines.join('\n')}\n`,
    stdio: ['pipe', 'ignore', 'ignore']
  })
  return repo
}
