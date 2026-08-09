import { realpath } from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  makeRepositoryAccess,
  type RepositoryAccess,
  RepositoryAccessFailure
} from '../../../src/agent/features/repository-access'
import { Effect } from 'effect4'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('Agent repository access', () => {
  let fixtureRoot: string
  let allowedRoot: string
  let allowedChild: string
  let outsideRoot: string
  let prefixSibling: string
  let regularFile: string
  let repositoryAccess: RepositoryAccess

  beforeEach(async () => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-agent-access-'))
    allowedRoot = path.join(fixtureRoot, 'allowed')
    allowedChild = path.join(allowedRoot, 'repository')
    outsideRoot = path.join(fixtureRoot, 'outside')
    prefixSibling = path.join(fixtureRoot, 'allowed-sibling')
    regularFile = path.join(allowedRoot, 'regular-file')
    fs.mkdirSync(allowedChild, { recursive: true })
    fs.mkdirSync(outsideRoot)
    fs.mkdirSync(prefixSibling)
    fs.writeFileSync(regularFile, 'not a directory')
    repositoryAccess = await Effect.runPromise(makeRepositoryAccess([allowedRoot]))
  })

  afterEach(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  })

  const authorizeFailure = (nativePath: string) =>
    Effect.runPromise(Effect.flip(repositoryAccess.authorizeDirectory(nativePath)))

  it('returns canonical native paths for an allowed root and its descendants', async () => {
    await expect(Effect.runPromise(repositoryAccess.authorizeDirectory(allowedRoot))).resolves.toBe(
      await realpath(allowedRoot)
    )
    await expect(
      Effect.runPromise(repositoryAccess.authorizeDirectory(`${allowedChild}${path.sep}`))
    ).resolves.toBe(await realpath(allowedChild))
  })

  it('rejects parent traversal even when it resolves to an existing directory', async () => {
    const traversalPath = `${allowedRoot}${path.sep}..${path.sep}${path.basename(outsideRoot)}`
    const failure = await authorizeFailure(traversalPath)

    expect(failure).toBeInstanceOf(RepositoryAccessFailure)
    expect(failure.reason).toBe('MalformedPath')
  })

  it('rejects a symlink that escapes an allowed root after canonicalization', async () => {
    const escapeLink = path.join(allowedRoot, 'escape-link')
    fs.symlinkSync(outsideRoot, escapeLink, process.platform === 'win32' ? 'junction' : 'dir')

    const failure = await authorizeFailure(escapeLink)

    expect(failure.reason).toBe('OutsideAllowedRoots')
  })

  it.each([
    ['', 'MalformedPath'],
    ['relative/repository', 'MalformedPath']
  ] as const)('rejects malformed path %j with %s', async (nativePath, reason) => {
    const failure = await authorizeFailure(nativePath)

    expect(failure.reason).toBe(reason)
  })

  it('rejects native paths containing a null byte', async () => {
    const failure = await authorizeFailure(`${allowedRoot}\0escape`)

    expect(failure.reason).toBe('MalformedPath')
  })

  it('distinguishes nonexistent paths and files from authorized directories', async () => {
    const missingFailure = await authorizeFailure(path.join(allowedRoot, 'missing'))
    const fileFailure = await authorizeFailure(regularFile)

    expect(missingFailure.reason).toBe('NotFound')
    expect(fileFailure.reason).toBe('NotDirectory')
  })

  it('rejects a prefix sibling and an unrelated existing directory', async () => {
    const siblingFailure = await authorizeFailure(prefixSibling)
    const outsideFailure = await authorizeFailure(outsideRoot)

    expect(siblingFailure.reason).toBe('OutsideAllowedRoots')
    expect(outsideFailure.reason).toBe('OutsideAllowedRoots')
  })

  it('canonicalizes an allowed root before enforcing it', async () => {
    const allowedRootLink = path.join(fixtureRoot, 'allowed-link')
    fs.symlinkSync(allowedRoot, allowedRootLink, process.platform === 'win32' ? 'junction' : 'dir')
    const linkedAccess = await Effect.runPromise(makeRepositoryAccess([allowedRootLink]))

    await expect(
      Effect.runPromise(linkedAccess.authorizeDirectory(path.join(allowedRootLink, 'repository')))
    ).resolves.toBe(await realpath(allowedChild))
  })

  it('accepts filesystem case aliases only when the native filesystem resolves them', async () => {
    const caseAlias = allowedChild.replace(/repository$/, 'REPOSITORY')
    let canonicalAlias: string
    try {
      canonicalAlias = await realpath(caseAlias)
    } catch {
      return
    }

    await expect(Effect.runPromise(repositoryAccess.authorizeDirectory(caseAlias))).resolves.toBe(
      canonicalAlias
    )
  })

  it('does not let filesystem case aliases escape the allowed root', async () => {
    const caseAlias = outsideRoot.replace(/outside$/, 'OUTSIDE')
    try {
      await realpath(caseAlias)
    } catch {
      return
    }

    const failure = await authorizeFailure(caseAlias)

    expect(failure.reason).toBe('OutsideAllowedRoots')
  })

  it('rejects invalid allowed roots while constructing the module', async () => {
    const missingRoot = path.join(fixtureRoot, 'missing-root')
    const missingFailure = await Effect.runPromise(
      Effect.flip(makeRepositoryAccess([missingRoot]))
    )
    const fileFailure = await Effect.runPromise(Effect.flip(makeRepositoryAccess([regularFile])))

    expect(missingFailure.reason).toBe('NotFound')
    expect(fileFailure.reason).toBe('NotDirectory')
  })
})
