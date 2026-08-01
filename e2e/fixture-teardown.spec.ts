import fs from 'node:fs'
import {
  createFixtureRepo,
  createFixturePathRegistry,
  expect,
  findUnexplainedFailureToasts,
  findToastMatch,
  removeFixturePaths,
  runWithFailureSafeCleanup,
  runWithFailureSafeFixtureTeardown,
  test,
  type RecordedToast,
  verifyReposClosed
} from './fixtures'

test('fixture cleanup retries transient filesystem failures', () => {
  const removals: Array<{ fixturePath: string; options: fs.RmOptions }> = []

  removeFixturePaths(['first', 'first', 'second'], (fixturePath, options) => {
    removals.push({ fixturePath, options })
  })

  expect(removals).toEqual([
    {
      fixturePath: 'first',
      options: { recursive: true, force: true, maxRetries: 20, retryDelay: 300 }
    },
    {
      fixturePath: 'second',
      options: { recursive: true, force: true, maxRetries: 20, retryDelay: 300 }
    }
  ])
})

test('failed test repos defer removal without cascading into worker closure checks', () => {
  const registry = createFixturePathRegistry()
  registry.track('completed')
  registry.track('failed')

  registry.release(['completed'])
  registry.deferRemoval(['failed'])

  expect(registry.pathsToClose()).toEqual([])
  expect(registry.pathsToRemove()).toEqual(['failed'])
})

test('toast matching resets stateful regular expressions', () => {
  const title = /permission denied/g
  title.test('permission denied')
  const recorded: RecordedToast[] = [
    { type: 'error', title: 'permission denied', description: '' }
  ]

  expect(
    findUnexplainedFailureToasts(recorded, [
      { expected: { type: 'error', title }, recordedIndex: 0 }
    ])
  ).toEqual([])
})

test('one expected toast does not suppress a duplicate failure', () => {
  const duplicate: RecordedToast = {
    type: 'warning',
    title: 'remote changed',
    description: 'fetch and retry'
  }

  expect(
    findUnexplainedFailureToasts(
      [duplicate, duplicate],
      [
        {
          expected: {
            type: 'warning',
            title: 'remote changed',
            description: 'fetch and retry'
          },
          recordedIndex: 0
        }
      ]
    )
  ).toEqual([duplicate])
})

test('a prior matching toast cannot satisfy or be consumed by a later expectation', () => {
  const expected = { type: 'error', title: 'push failed' } as const
  const prior: RecordedToast = { type: 'error', title: 'push failed', description: 'first' }

  expect(findToastMatch([prior], expected, 1)).toBeUndefined()

  const later: RecordedToast = { type: 'error', title: 'push failed', description: 'second' }
  const match = findToastMatch([prior, later], expected, 1)
  expect(match).toEqual({ toast: later, recordedIndex: 1 })
  expect(
    findUnexplainedFailureToasts([prior, later], [
      { expected, recordedIndex: match?.recordedIndex ?? -1 }
    ])
  ).toEqual([prior])
})

test('failure-safe teardown attempts every step and preserves the original failure', async ({
  harness
}) => {
  const originalError = new Error('original lifecycle assertion')
  const cleanupOrder: string[] = []

  expect(harness.app()).toBeTruthy()

  await expect(
    runWithFailureSafeCleanup(async () => {}, [
      () => {
        cleanupOrder.push('inspect lifecycle')
        throw originalError
      },
      () => {
        cleanupOrder.push('close repos')
        throw new Error('close repos failed')
      },
      () => {
        cleanupOrder.push('restore dialog')
      },
      () => {
        cleanupOrder.push('reset store and storage')
      },
      () => {
        cleanupOrder.push('close app')
      },
      () => {
        cleanupOrder.push('remove fixtures')
      }
    ])
  ).rejects.toBe(originalError)

  expect(cleanupOrder).toEqual([
    'inspect lifecycle',
    'close repos',
    'restore dialog',
    'reset store and storage',
    'close app',
    'remove fixtures'
  ])
})

test('a still-open owned repo fails closure verification and retains its path', async ({
  harness
}) => {
  const repo = createFixtureRepo()
  const owner = 20_001
  const originalError = new Error('original test failure')
  const cleanupOrder: string[] = []

  const opened = await harness.page.evaluate(
    async ({ ownerToken, repoPath }) => {
      const api = (
        window as unknown as {
          electronAPI: {
            openRepo: (path: string, owner: number) => Promise<{ _tag: string }>
          }
        }
      ).electronAPI
      return api.openRepo(repoPath, ownerToken)
    },
    { ownerToken: owner, repoPath: repo }
  )
  expect(opened._tag).toBe('Ok')

  await expect(
    runWithFailureSafeFixtureTeardown(
      async () => {
        throw originalError
      },
      {
        closeRepos: async () => {
          cleanupOrder.push('close repos')
          await verifyReposClosed(harness.page, [repo], 250)
        },
        afterCloseRepos: [
          () => {
            cleanupOrder.push('restore dialog')
          },
          () => {
            cleanupOrder.push('reset store')
          },
          () => {
            cleanupOrder.push('clear renderer state')
          },
          () => {
            cleanupOrder.push('reload renderer')
          }
        ],
        removeFixturePaths: () => {
          cleanupOrder.push('remove fixtures')
          fs.rmSync(repo, { recursive: true, force: true })
        }
      }
    )
  ).rejects.toBe(originalError)

  expect(cleanupOrder).toEqual([
    'close repos',
    'restore dialog',
    'reset store',
    'clear renderer state',
    'reload renderer'
  ])
  expect(fs.existsSync(repo)).toBe(true)

  await harness.page.evaluate(
    async ({ ownerToken, repoPath }) => {
      const api = (
        window as unknown as {
          electronAPI: {
            closeRepo: (path: string, owner: number) => Promise<void>
          }
        }
      ).electronAPI
      await api.closeRepo(repoPath, ownerToken)
    },
    { ownerToken: owner, repoPath: repo }
  )

  await runWithFailureSafeFixtureTeardown(async () => {}, {
    closeRepos: async () => {
      cleanupOrder.push('retry close repos')
      await verifyReposClosed(harness.page, [repo])
    },
    closeApp: () => {
      cleanupOrder.push('close app')
      expect(fs.existsSync(repo)).toBe(true)
    },
    removeFixturePaths: () => {
      cleanupOrder.push('remove fixtures after app shutdown')
      fs.rmSync(repo, { recursive: true, force: true })
    },
    afterRemoveFixturePaths: [
      () => {
        cleanupOrder.push('assert lifecycle counts')
      }
    ]
  })

  expect(cleanupOrder).toEqual([
    'close repos',
    'restore dialog',
    'reset store',
    'clear renderer state',
    'reload renderer',
    'retry close repos',
    'close app',
    'remove fixtures after app shutdown',
    'assert lifecycle counts'
  ])
  expect(fs.existsSync(repo)).toBe(false)
  expect(harness.app()).toBeTruthy()
})
