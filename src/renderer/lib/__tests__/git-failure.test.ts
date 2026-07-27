import { describe, expect, it } from 'vitest'
import { classifyGitFailure, gitFailureBannerText } from '@/lib/git-failure'

describe('classifyGitFailure', () => {
  it('names the suppressed HTTPS prompt and points at credential setup', () => {
    const failure = classifyGitFailure(
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled"
    )

    expect(failure.kind).toBe('auth-missing')
    expect(failure.description).toContain('github.com')
    expect(failure.description).toContain('credential helper')
    expect(failure.helpTopic).toBe('git-credentials')
  })

  it('points an SSH remote at the agent instead of a credential helper', () => {
    const failure = classifyGitFailure(
      'fatal: could not read Password for ssh://git@example.com: terminal prompts disabled'
    )

    expect(failure.kind).toBe('auth-missing')
    expect(failure.helpTopic).toBe('ssh-keys')
    expect(failure.description).toContain('SSH')
  })

  it('reads a refused public key as a rejected SSH credential', () => {
    const failure = classifyGitFailure(
      'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.'
    )

    expect(failure.kind).toBe('auth-rejected')
    expect(failure.helpTopic).toBe('ssh-keys')
    expect(failure.description).toContain('github.com')
  })

  it('reads an HTTPS 403 as rejected credentials', () => {
    const failure = classifyGitFailure(
      "fatal: unable to access 'https://gitlab.com/acme/app.git/': The requested URL returned error: 403"
    )

    expect(failure.kind).toBe('auth-rejected')
    expect(failure.helpTopic).toBe('git-credentials')
  })

  it('separates an unknown host key from a changed one', () => {
    expect(classifyGitFailure('Host key verification failed.').kind).toBe('host-key-unknown')
    expect(
      classifyGitFailure('@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@').kind
    ).toBe('host-key-changed')
  })

  it('classifies unreachable hosts as network failures', () => {
    const dns = classifyGitFailure(
      "fatal: unable to access 'https://github.com/acme/app.git/': Could not resolve host: github.com"
    )
    expect(dns.kind).toBe('network')
    expect(dns.description).toContain('github.com')
    expect(dns.helpTopic).toBeUndefined()

    expect(
      classifyGitFailure('ssh: connect to host github.com port 22: Connection timed out').kind
    ).toBe('network')
  })

  it('tells a rejected push from a diverged pull', () => {
    expect(
      classifyGitFailure(
        ' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs'
      ).kind
    ).toBe('non-fast-forward')
    expect(classifyGitFailure('fatal: Not possible to fast-forward, aborting.').kind).toBe(
      'diverged'
    )
  })

  it('lists the files a dirty working tree blocks the operation with', () => {
    const failure = classifyGitFailure(
      [
        'error: Your local changes to the following files would be overwritten by checkout:',
        '\tsrc/app.ts',
        '\tsrc/index.ts',
        'Please commit your changes or stash them before you switch branches.',
        'Aborting'
      ].join('\n')
    )

    expect(failure.kind).toBe('dirty-tree')
    expect(failure.description).toContain('src/app.ts, src/index.ts')
    expect(failure.description).toContain('stash')
  })

  // git reports both lists in one refusal, each under its own header — the tracked files must not be
  // read out under the untracked heading.
  it('keeps the tracked and untracked lists apart when a checkout hits both', () => {
    const failure = classifyGitFailure(
      [
        'error: Your local changes to the following files would be overwritten by checkout:',
        '\tREADME.md',
        'Please commit your changes or stash them before you switch branches.',
        'error: The following untracked working tree files would be overwritten by checkout:',
        '\tnotes.md',
        'Please move or remove them before you switch branches.',
        'Aborting'
      ].join('\n')
    )

    expect(failure.kind).toBe('dirty-tree')
    expect(failure.description).toBe(
      'Uncommitted changes to README.md and untracked notes.md would be overwritten. Commit or stash the changes and move the untracked files, then try again.'
    )
  })

  it('caps a long blocking-file list', () => {
    const failure = classifyGitFailure(
      [
        'error: The following untracked working tree files would be overwritten by merge:',
        '\ta.ts',
        '\tb.ts',
        '\tc.ts',
        '\td.ts',
        '\te.ts',
        'Please move or remove them before you merge.'
      ].join('\n')
    )

    expect(failure.kind).toBe('untracked-overwrite')
    expect(failure.description).toContain('a.ts, b.ts, c.ts and 2 more')
  })

  it('repeats what the remote hook said', () => {
    const failure = classifyGitFailure(
      [
        'remote: error: GH006: Protected branch update failed for refs/heads/main.',
        ' ! [remote rejected] main -> main (protected branch hook declined)'
      ].join('\n')
    )

    expect(failure.kind).toBe('hook-rejected')
    expect(failure.description).toContain('Protected branch update failed')
  })

  // git tails almost every transport failure with "Could not read from remote repository… correct
  // access rights", so a missing remote must not be read as rejected credentials.
  it('reads a push with no remote configured as a missing remote, not an auth problem', () => {
    const failure = classifyGitFailure(
      [
        "fatal: 'origin' does not appear to be a git repository",
        'fatal: Could not read from remote repository.',
        '',
        'Please make sure you have the correct access rights',
        'and the repository exists.'
      ].join('\n')
    )

    expect(failure.kind).toBe('no-remote')
    expect(failure.description).toContain('no remote named origin')
    expect(failure.helpTopic).toBeUndefined()
  })

  it('reads a remote URL that is not a repository as a bad URL', () => {
    const failure = classifyGitFailure(
      "fatal: '/tmp/gone.git' does not appear to be a git repository"
    )

    expect(failure.kind).toBe('remote-missing')
    expect(failure.description).toContain('/tmp/gone.git')
  })

  it('recognises the local failures that are not about the remote', () => {
    expect(
      classifyGitFailure("fatal: Unable to create '/repo/.git/index.lock': File exists.").kind
    ).toBe('index-lock')
    expect(classifyGitFailure('fatal: refusing to merge unrelated histories').kind).toBe(
      'unrelated-histories'
    )
    expect(classifyGitFailure("fatal: A branch named 'feature' already exists.").kind).toBe(
      'ref-exists'
    )
    expect(classifyGitFailure("error: the branch 'feature' is not fully merged.").kind).toBe(
      'branch-not-merged'
    )
    expect(
      classifyGitFailure(
        'There is no tracking information for the current branch.\nPlease specify which branch you want to merge with.'
      ).kind
    ).toBe('no-upstream')
  })

  it('passes an unrecognised message through untouched', () => {
    const failure = classifyGitFailure('fatal: something nobody has seen before')

    expect(failure.kind).toBe('unknown')
    expect(failure.description).toBe('fatal: something nobody has seen before')
  })

  it('says so when git reported nothing at all', () => {
    expect(classifyGitFailure('   ').description).toBe('Git failed without reporting a reason.')
  })
})

describe('gitFailureBannerText', () => {
  it('prefixes the explanation with what was being done', () => {
    expect(
      gitFailureBannerText(
        'Fetch failed',
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled"
      )
    ).toMatch(/^Fetch failed: github\.com asked for credentials/)
  })
})
