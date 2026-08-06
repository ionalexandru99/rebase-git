import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export async function notarizeDmg({ artifactPaths }) {
  if (process.platform !== 'darwin' || !process.env.APPLE_TEAM_ID) {
    return []
  }

  const dmgPaths = artifactPaths.filter((artifactPath) => artifactPath.endsWith('.dmg'))

  for (const dmgPath of dmgPaths) {
    console.log(`  • notarizing dmg  file=${dmgPath}`)
    await run('xcrun', [
      'notarytool',
      'submit',
      dmgPath,
      '--wait',
      '--apple-id',
      process.env.APPLE_ID,
      '--password',
      process.env.APPLE_APP_SPECIFIC_PASSWORD,
      '--team-id',
      process.env.APPLE_TEAM_ID
    ])
    await run('xcrun', ['stapler', 'staple', dmgPath])
    console.log(`  • stapled dmg  file=${dmgPath}`)
  }

  return []
}
