import { Effect } from "effect";
import {
  type CommitDraft,
  type DiffPreferences,
  defaultDiffPreferences,
  emptyCommitDraft,
  WorkingChangesError,
} from "#web/features/working-changes/working-changes.contract";
import {
  requestResult,
  transactionCompleted,
  withRepositoryHistoryDatabase,
  workingChangesStoreName,
} from "#web/persistence/repository-history/repository-history-database";

function access<T>(use: (store: IDBObjectStore) => Promise<T>, write: boolean) {
  return Effect.tryPromise({
    try: () =>
      withRepositoryHistoryDatabase(globalThis.indexedDB, async (database) => {
        const transaction = database.transaction(
          workingChangesStoreName,
          write ? "readwrite" : "readonly",
        );
        const complete = transactionCompleted(transaction);
        const [result] = await Promise.all([
          use(transaction.objectStore(workingChangesStoreName)),
          complete,
        ]);
        return result;
      }),
    catch: () =>
      new WorkingChangesError({
        message:
          "Could not access changes preferences or the commit draft in this browser.",
      }),
  });
}
export function readCommitDraft(key: string) {
  return access(
    (store) => requestResult<unknown>(store.get(`draft:${key}`)),
    false,
  ).pipe(
    Effect.map((value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        !("subject" in value) ||
        !("description" in value) ||
        typeof value.subject !== "string" ||
        typeof value.description !== "string"
      )
        return emptyCommitDraft;
      return {
        subject: value.subject,
        description: value.description,
      } satisfies CommitDraft;
    }),
  );
}
export function saveCommitDraft(key: string, draft: CommitDraft) {
  return access(
    (store) => requestResult(store.put(draft, `draft:${key}`)),
    true,
  ).pipe(Effect.asVoid);
}
export function readDiffPreferences() {
  return access(
    (store) => requestResult<unknown>(store.get("preferences")),
    false,
  ).pipe(
    Effect.map((value) => {
      if (typeof value !== "object" || value === null)
        return defaultDiffPreferences;
      const read = (key: keyof DiffPreferences): boolean => {
        const stored: unknown = Reflect.get(value, key);
        return typeof stored === "boolean"
          ? stored
          : defaultDiffPreferences[key];
      };
      return {
        split: read("split"),
        wrap: read("wrap"),
        tree: read("tree"),
      } satisfies DiffPreferences;
    }),
  );
}
export function saveDiffPreferences(value: DiffPreferences) {
  return access(
    (store) => requestResult(store.put(value, "preferences")),
    true,
  ).pipe(Effect.asVoid);
}
