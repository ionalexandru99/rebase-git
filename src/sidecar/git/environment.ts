const BATCH_MODE = '-o BatchMode=yes'

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
