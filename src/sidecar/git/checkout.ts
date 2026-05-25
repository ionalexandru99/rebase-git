export function deriveLocalShortName(remoteFullPath: string): string {
  const slash = remoteFullPath.indexOf('/')
  return slash === -1 ? remoteFullPath : remoteFullPath.slice(slash + 1)
}
