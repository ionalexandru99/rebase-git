import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')

async function findElectron() {
  const candidates = [
    resolve(rootDir, 'node_modules/.bin/electron'),
    resolve(rootDir, 'node_modules/.bin/electron.cmd'),
    resolve(rootDir, 'node_modules/electron/dist/electron'),
    resolve(rootDir, 'node_modules/electron/dist/electron.exe'),
  ]

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }

  return 'npx'
}

async function runSmokeTest() {
  const electronBin = await findElectron()
  const mainJs = resolve(rootDir, 'out/main/index.js')

  console.log('\nLaunching Electron smoke test...')
  console.log(`Binary: ${electronBin}`)
  console.log(`Main: ${mainJs}`)

  const electronArgs = [
    mainJs,
    '--no-sandbox',
    ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : []),
  ]
  const args = electronBin === 'npx' ? ['electron', ...electronArgs] : electronArgs
  const electronEnv = {
    ...process.env,
    VITE_DEV_SERVER_URL: '',
    ELECTRON_ENABLE_LOGGING: '1',
    NODE_ENV: 'test',
  }
  delete electronEnv.ELECTRON_RUN_AS_NODE
  if (process.platform === 'linux') {
    electronEnv.ELECTRON_OZONE_PLATFORM_HINT = 'x11'
  }

  const child = spawn(electronBin, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: rootDir,
    env: electronEnv,
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    console.log('Smoke test timeout reached (10s), killing process...')
    child.kill()
  }, 10_000)

  return new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      clearTimeout(timeout)

      const fatalPatterns = [
        'Cannot find module',
        'MODULE_NOT_FOUND',
        'Refused to execute',
        'Uncaught Error',
        'Uncaught TypeError',
        'Uncaught ReferenceError',
        'TypeError:',
        'ReferenceError:',
      ]
      const failures = fatalPatterns.filter((pattern) => output.includes(pattern))

      if (failures.length > 0) {
        console.error('\nDesktop smoke test failed:')
        for (const failure of failures) {
          console.error(` - Found fatal pattern: "${failure}"`)
        }
        console.error('\n--- Full output ---\n' + output)
        reject(new Error('Smoke test failed'))
      } else if (!timedOut && code !== null && code !== 0) {
        console.error(`\nDesktop exited with code ${code}`)
        console.error('\n--- Full output ---\n' + output)
        reject(new Error(`Smoke test exited with code ${code}`))
      } else {
        console.log('Desktop smoke test passed.')
        resolve()
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      console.error(`\nFailed to start Electron: ${err.message}`)
      reject(err)
    })
  })
}

runSmokeTest().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
