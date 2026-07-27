// Network git must never block on a prompt it can never get answered: a credential prompt in a
// forked utility process hangs forever instead of failing. GIT_TERMINAL_PROMPT closes the terminal
// route; the askpass ones close the GUI route — on a desktop that exports SSH_ASKPASS (KDE, GNOME)
// git and ssh otherwise pop an OS password window from a headless process and wait on it forever.
// Non-interactive credential helpers and ssh-agent still answer, so configured auth keeps working
// and everything else fails fast with a message we can show.
export function promptlessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS_REQUIRE: 'never',
    LC_ALL: 'C'
  }
  delete env.SSH_ASKPASS
  return env
}
