import { execFileSync } from 'node:child_process'

export function buildAgent(): void {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  try {
    execFileSync(command, ['build:agent'], {
      stdio: 'pipe',
      shell: process.platform === 'win32'
    })
  } catch (error) {
    const failure = error as { readonly stdout?: Buffer; readonly stderr?: Buffer }
    throw new Error(
      ['Agent build failed', failure.stdout?.toString(), failure.stderr?.toString()]
        .filter(Boolean)
        .join('\n'),
      { cause: error }
    )
  }
}
