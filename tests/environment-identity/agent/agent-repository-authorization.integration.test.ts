import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  AGENT_PROTOCOL,
  RepositoryPathRejected
} from '@common/features/agent-connection'
import { Effect } from 'effect4'
import {
  buildAgent,
  claimAgent,
  runAgentRpc,
  startAgent,
  stopAgent
} from '../../agent-connection/agent/agent-process-harness'

beforeAll(buildAgent)

describe.sequential('Agent repository authorization boundary', () => {
  let temporaryRoot = ''
  let allowedRoot = ''

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'rebase-agent-authorization-'))
    allowedRoot = path.join(temporaryRoot, 'allowed')
    await mkdir(path.join(allowedRoot, 'repository'), { recursive: true })
  })

  afterEach(async () => {
    await rm(temporaryRoot, { recursive: true, force: true })
  })

  it('returns only the canonical native path and rejects escapes through the real RPC seam', async () => {
    const outsideRoot = path.join(temporaryRoot, 'outside')
    await mkdir(outsideRoot)
    const escape = path.join(allowedRoot, 'escape')
    await symlink(outsideRoot, escape, process.platform === 'win32' ? 'junction' : 'dir')
    const agent = await startAgent([
      '--allowed-root',
      allowedRoot,
      '--orphan-timeout-ms',
      '5000'
    ])

    try {
      const claim = await claimAgent(agent)
      const { sessionToken } = await claim.json()
      const result = await runAgentRpc(agent, sessionToken, (client) =>
        Effect.gen(function* () {
          yield* client.openAgentSession({ agentProtocol: AGENT_PROTOCOL })
          return yield* client.authorizeRepositoryPath({
            nativePath: path.join(allowedRoot, 'repository')
          })
        })
      )

      expect(result).toEqual({
        canonicalPath: await realpath(path.join(allowedRoot, 'repository'))
      })
      await expect(
        runAgentRpc(agent, sessionToken, (client) =>
          client.authorizeRepositoryPath({ nativePath: escape })
        )
      ).rejects.toMatchObject(
        new RepositoryPathRejected({ reason: 'OutsideAllowedRoots' })
      )
    } finally {
      await stopAgent(agent)
    }
  })
})
