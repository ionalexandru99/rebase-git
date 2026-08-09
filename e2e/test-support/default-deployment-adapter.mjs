import fs from 'node:fs'
import path from 'node:path'

function markerPath(name) {
  const markerRoot = process.env.REBASE_E2E_ADAPTER_MARKER_ROOT
  if (!markerRoot) {
    throw new Error('adapter marker root is unavailable')
  }
  return path.join(markerRoot, name)
}

export default {
  name: 'default-adapter',
  async createHarness(context) {
    fs.writeFileSync(markerPath('created'), context.fixtureRoot)
    return {
      deploymentName: 'default-adapter',
      globalGitConfigPath: context.globalGitConfigPath,
      async close() {
        fs.writeFileSync(markerPath('closed'), 'closed')
      }
    }
  }
}
