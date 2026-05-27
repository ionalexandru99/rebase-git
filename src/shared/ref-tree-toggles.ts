export const REF_TREE_REMOTE_SECTION_KEY = 'section:remote:expanded'
export const REF_TREE_TAG_SECTION_KEY = 'section:tag:expanded'

export function isRemoteOrTagSectionToggle(key: string): boolean {
  return key === REF_TREE_REMOTE_SECTION_KEY || key === REF_TREE_TAG_SECTION_KEY
}

export function filterPersistedRefTreeToggles(keys: readonly string[]): string[] {
  return keys.filter((key) => !isRemoteOrTagSectionToggle(key))
}
