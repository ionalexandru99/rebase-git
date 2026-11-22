import {
  createStoredStore,
  useStoredStore,
} from "#web/platform/store/stored-store.ts";
import { useStore } from "#web/platform/store/use-store.ts";

export interface CommitDraft {
  readonly subject: string;
  readonly description: string;
}

const emptyCommitDraft: CommitDraft = { subject: "", description: "" };

export function useCommitDraft(key: string, message: string | undefined) {
  const store = useStoredStore(draftStorageKey(key), decodeDraft);
  const stored = useStore(store);
  const clear = (keys: readonly string[]) => {
    for (const cleared of keys)
      if (cleared !== key)
        createStoredStore(draftStorageKey(cleared), decodeDraft).set(null);
    store.set(null);
  };
  return {
    draft:
      stored ??
      (message === undefined ? emptyCommitDraft : draftFromMessage(message)),
    edit: (draft: CommitDraft) => store.set(draft),
    clear,
  };
}

function draftStorageKey(key: string) {
  return `rebase:commit-draft:v1:${key}`;
}

function decodeDraft(saved: unknown): CommitDraft | null {
  if (
    typeof saved !== "object" ||
    saved === null ||
    !("subject" in saved) ||
    !("description" in saved) ||
    typeof saved.subject !== "string" ||
    typeof saved.description !== "string"
  )
    return null;
  return { subject: saved.subject, description: saved.description };
}

export function commitMessage({ subject, description }: CommitDraft) {
  const body = description.trim();
  return subject.trim() + (body ? `\n\n${body}` : "");
}

export function draftFromMessage(message: string): CommitDraft {
  const [subject = "", ...body] = message.split(/\r?\n/);
  return { subject, description: body.join("\n").trimStart() };
}

export function amendDraftKey(draftKey: string, head: string | null) {
  return `${draftKey}:amend:${head}`;
}
