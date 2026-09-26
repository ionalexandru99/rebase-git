import {
  type DiffPreferences,
  defaultDiffPreferences,
} from "#web/domain/file-diff/diff-preferences.contract";
import {
  requestResult,
  transactionCompleted,
  withRepositoryHistoryDatabase,
  workingChangesStoreName,
} from "#web/persistence/repository-history/repository-history-database";
import {
  type CommitDraft,
  emptyCommitDraft,
} from "#web/persistence/working-changes/working-changes-store.contract";

let writes: Promise<unknown> = Promise.resolve();

export async function readCommitDraft(key: string): Promise<CommitDraft> {
  const value = await readStored(`draft:${key}`);
  if (
    typeof value !== "object" ||
    value === null ||
    !("subject" in value) ||
    !("description" in value) ||
    typeof value.subject !== "string" ||
    typeof value.description !== "string"
  )
    return emptyCommitDraft;
  return { subject: value.subject, description: value.description };
}

export function saveCommitDraft(key: string, draft: CommitDraft) {
  return write((store) => store.put(draft, `draft:${key}`));
}

export async function readDiffPreferences(): Promise<DiffPreferences> {
  const value = await readStored("preferences");
  if (typeof value !== "object" || value === null)
    return defaultDiffPreferences;
  const read = (key: keyof DiffPreferences): boolean => {
    const stored: unknown = Reflect.get(value, key);
    return typeof stored === "boolean" ? stored : defaultDiffPreferences[key];
  };
  return { split: read("split"), wrap: read("wrap"), tree: read("tree") };
}

export function saveDiffPreferences(preferences: DiffPreferences) {
  return write((store) => store.put(preferences, "preferences"));
}

async function readStored(key: string) {
  await writes;
  return access((store) => requestResult<unknown>(store.get(key)), "readonly");
}

function write(put: (store: IDBObjectStore) => IDBRequest) {
  const written = writes.then(() =>
    access((store) => requestResult(put(store)), "readwrite"),
  );
  writes = written.catch(() => undefined);
  return written.then(() => undefined);
}

function access<T>(
  use: (store: IDBObjectStore) => Promise<T>,
  mode: IDBTransactionMode,
) {
  return withRepositoryHistoryDatabase(
    globalThis.indexedDB,
    async (database) => {
      const transaction = database.transaction(workingChangesStoreName, mode);
      const [result] = await Promise.all([
        use(transaction.objectStore(workingChangesStoreName)),
        transactionCompleted(transaction),
      ]);
      return result;
    },
  );
}
