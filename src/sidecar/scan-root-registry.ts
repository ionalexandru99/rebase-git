const validatedScanRoots = new Map<number, string>()
let nextScanRootId = 0

export function storeValidatedScanRoot(canonicalPath: string): number {
  const id = ++nextScanRootId
  validatedScanRoots.set(id, canonicalPath)
  return id
}

export function takeValidatedScanRoot(id: number): string | undefined {
  const canonicalPath = validatedScanRoots.get(id)
  if (canonicalPath === undefined) {
    return undefined
  }
  validatedScanRoots.delete(id)
  return canonicalPath
}

export function clearValidatedScanRoots(): void {
  validatedScanRoots.clear()
}
