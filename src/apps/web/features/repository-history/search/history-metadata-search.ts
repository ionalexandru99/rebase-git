import type {
  RepositoryCommit,
  RepositoryHistoryRefTarget,
} from "@rebase/contracts";

export function normalizeHistorySearch(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function matchingHistoryMetadata(
  text: string,
  refs: readonly RepositoryHistoryRefTarget[],
) {
  const words = normalizeHistorySearch(text).split(" ").filter(Boolean);
  const refsByOid = new Map<string, string[]>();
  for (const ref of refs) {
    const names = refsByOid.get(ref.oid) ?? [];
    names.push(ref.name.toLowerCase());
    refsByOid.set(ref.oid, names);
  }
  return (commit: RepositoryCommit) => {
    if (words.length === 0) return false;
    const fields = [
      commit.oid,
      commit.subject,
      commit.author.name,
      commit.author.email,
      ...(refsByOid.get(commit.oid) ?? []),
    ].map((field) => field.toLowerCase());
    return words.every((word) => fields.some((field) => field.includes(word)));
  };
}
