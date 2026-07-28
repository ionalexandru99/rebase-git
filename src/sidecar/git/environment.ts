const BATCH_MODE = '-o BatchMode=yes'

/**
 * Makes every git process the sidecar spawns fail rather than wait for a human.
 *
 * GIT_TERMINAL_PROMPT only silences the *terminal* prompt: with a desktop askpass helper configured
 * (KDE and GNOME both set SSH_ASKPASS), git still pops a dialog, and an operation launched from a
 * background process hangs on a window nobody connects to the app. Dropping both askpass variables
 * turns that hang into an immediate failure the renderer can explain; the third path, `core.askpass`,
 * is emptied on the command line in spawn.ts. BatchMode does the same for ssh's own passphrase and
 * host-key prompts, and LC_ALL pins the language those failures are reported in.
 */
export function applyNonInteractiveGitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  env.GIT_TERMINAL_PROMPT = '0'
  env.LC_ALL = 'C'
  delete env.GIT_ASKPASS
  delete env.SSH_ASKPASS
  const sshCommand = env.GIT_SSH_COMMAND ?? 'ssh'
  env.GIT_SSH_COMMAND = sshCommand.includes('BatchMode')
    ? sshCommand
    : `${sshCommand} ${BATCH_MODE}`
  return env
}
