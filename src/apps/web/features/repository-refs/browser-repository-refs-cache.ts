import { RepositoryRefs } from "@rebase/contracts";
import { Schema } from "effect";
import { accessRepositoryRefsStore } from "#web/persistence/repository-refs/repository-refs-database";

export async function readCachedRepositoryRefs(
  environmentId: string,
  logicalRepositoryId: string,
): Promise<RepositoryRefs | undefined> {
  try {
    const value = await accessRepositoryRefsStore("readonly", (store) =>
      store.get([environmentId, logicalRepositoryId]),
    );
    if (value === undefined) return undefined;
    const refs = Schema.decodeUnknownSync(RepositoryRefs)(value);
    return (refs.logicalRepositoryId ?? refs.repositoryId) ===
      logicalRepositoryId
      ? refs
      : undefined;
  } catch {
    return undefined;
  }
}

export async function cacheRepositoryRefs(
  environmentId: string,
  logicalRepositoryId: string,
  refs: RepositoryRefs,
): Promise<void> {
  if ((refs.logicalRepositoryId ?? refs.repositoryId) !== logicalRepositoryId)
    return;
  try {
    await accessRepositoryRefsStore("readwrite", (store) =>
      store.put(refs, [environmentId, logicalRepositoryId]),
    );
  } catch {
    return;
  }
}

export async function clearCachedRepositoryRefs(
  environmentId: string,
  logicalRepositoryId: string,
): Promise<void> {
  await accessRepositoryRefsStore("readwrite", (store) =>
    store.delete([environmentId, logicalRepositoryId]),
  );
}

export async function clearAllCachedRepositoryRefs(): Promise<void> {
  await accessRepositoryRefsStore("readwrite", (store) => store.clear());
}
