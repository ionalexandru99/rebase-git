import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from './fixtures'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

test.describe.configure({ mode: 'serial' })

for (const adapter of [
  { module: 'default-deployment-adapter.mjs', name: 'default-adapter' },
  { module: 'named-deployment-adapter.mjs', name: 'named-adapter' }
]) {
  test.describe(`${adapter.name} module`, () => {
    let markerRoot = ''
    let originalAdapterModule: string | undefined
    let originalMarkerRoot: string | undefined

    test.beforeAll(() => {
      originalAdapterModule = process.env.REBASE_E2E_DEPLOYMENT_ADAPTER
      originalMarkerRoot = process.env.REBASE_E2E_ADAPTER_MARKER_ROOT
      markerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rebase-adapter-smoke-'))
      process.env.REBASE_E2E_ADAPTER_MARKER_ROOT = markerRoot
      process.env.REBASE_E2E_DEPLOYMENT_ADAPTER = path.join(
        currentDirectory,
        'test-support',
        adapter.module
      )
    })

    test.afterAll(() => {
      try {
        const closedMarker = fs.readFileSync(path.join(markerRoot, 'closed'), 'utf8')
        const fixtureRoot = fs.readFileSync(path.join(markerRoot, 'created'), 'utf8')
        expect(closedMarker).toBe('closed')
        expect(fs.existsSync(fixtureRoot)).toBe(false)
      } finally {
        if (originalAdapterModule === undefined) {
          delete process.env.REBASE_E2E_DEPLOYMENT_ADAPTER
        } else {
          process.env.REBASE_E2E_DEPLOYMENT_ADAPTER = originalAdapterModule
        }
        if (originalMarkerRoot === undefined) {
          delete process.env.REBASE_E2E_ADAPTER_MARKER_ROOT
        } else {
          process.env.REBASE_E2E_ADAPTER_MARKER_ROOT = originalMarkerRoot
        }
        fs.rmSync(markerRoot, { recursive: true, force: true })
      }
    })

    test('creates and closes the selected deployment adapter', async ({ harness }) => {
      expect(harness.deploymentName).toBe(adapter.name)
      const fixtureRoot = fs.readFileSync(path.join(markerRoot, 'created'), 'utf8')
      expect(fs.existsSync(fixtureRoot)).toBe(true)
    })
  })
}
