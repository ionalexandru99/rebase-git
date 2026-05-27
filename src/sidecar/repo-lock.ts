const repoTails = new Map<string, Promise<void>>()

export async function withRepoLock<T>(repoPath: string, work: () => Promise<T>): Promise<T> {
  const previous = repoTails.get(repoPath) ?? Promise.resolve()
  let release: () => void = () => {}
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.catch(() => {}).then(() => current)
  repoTails.set(repoPath, tail)

  await previous.catch(() => {})
  try {
    return await work()
  } finally {
    release()
    if (repoTails.get(repoPath) === tail) {
      repoTails.delete(repoPath)
    }
  }
}

export function repoLockCount(): number {
  return repoTails.size
}
