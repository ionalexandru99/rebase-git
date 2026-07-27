const BATCH_MODE = '-o BatchMode=yes'

function neutralizeAskpassConfig(env: NodeJS.ProcessEnv): void {
  const declared = Number.parseInt(env.GIT_CONFIG_COUNT ?? '', 10)
  const count = Number.isInteger(declared) && declared > 0 ? declared : 0
  for (let index = 0; index < count; index++) {
    if (env[`GIT_CONFIG_KEY_${index}`] === 'core.askpass') {
      env[`GIT_CONFIG_VALUE_${index}`] = ''
      return
    }
  }
  env[`GIT_CONFIG_KEY_${count}`] = 'core.askpass'
  env[`GIT_CONFIG_VALUE_${count}`] = ''
  env.GIT_CONFIG_COUNT = String(count + 1)
}

/**
 * Makes every git process the sidecar spawns fail rather than wait for a human.
 *
 * GIT_TERMINAL_PROMPT only silences the *terminal* prompt: with a desktop askpass helper configured
 * (KDE and GNOME both set SSH_ASKPASS), git still pops a dialog, and an operation launched from a
 * background process hangs on a window nobody connects to the app. Clearing every askpass path — the
 * two environment variables and `core.askpass`, which is why the config lands through git's
 * config-environment protocol rather than a flag on each call — turns that hang into an immediate
 * failure the renderer can explain. BatchMode does the same for ssh's own passphrase and host-key
 * prompts, and LC_ALL pins the language those failures are reported in.
 */
export function applyNonInteractiveGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  env.GIT_TERMINAL_PROMPT = '0'
  env.LC_ALL = 'C'
  delete env.GIT_ASKPASS
  delete env.SSH_ASKPASS
  neutralizeAskpassConfig(env)
  const sshCommand = env.GIT_SSH_COMMAND ?? 'ssh'
  env.GIT_SSH_COMMAND = sshCommand.includes('BatchMode')
    ? sshCommand
    : `${sshCommand} ${BATCH_MODE}`
  return env
}
