// Network git must never block on a terminal prompt it can never get: a credential prompt in a
// forked utility process hangs forever instead of failing. Credential helpers and ssh-agent still
// work — only the interactive fallback is off. LC_ALL pins the messages we classify.
export function promptlessEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C'
  }
}
