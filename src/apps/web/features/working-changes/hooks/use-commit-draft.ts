import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { draftFromMessage } from "#web/features/working-changes/draft/commit-draft";
import {
  readCommitDraft,
  saveCommitDraft,
} from "#web/persistence/working-changes/working-changes-store";
import {
  type CommitDraft,
  emptyCommitDraft,
} from "#web/persistence/working-changes/working-changes-store.contract";

const saveDelayMilliseconds = 300;

interface PendingSave {
  readonly key: string;
  readonly draft: CommitDraft;
}

export function useCommitDraft(key: string | undefined, message?: string) {
  const drafts = useRef(new Map<string, CommitDraft>());
  const [, redraw] = useReducer((version: number) => version + 1, 0);
  const [shownKey, setShownKey] = useState(key);
  if (key !== undefined && key !== shownKey) setShownKey(key);
  useRestoredDraft(key, message, drafts.current, redraw);
  const saving = useDebouncedSave();
  const edit = useCallback(
    (draft: CommitDraft) => {
      if (key === undefined) return;
      drafts.current.set(key, draft);
      redraw();
      saving.schedule({ key, draft });
    },
    [key, saving],
  );
  const clear = useCallback(
    (keys: readonly string[]) => {
      saving.cancel();
      for (const cleared of keys) {
        drafts.current.set(cleared, emptyCommitDraft);
        saveCommitDraft(cleared, emptyCommitDraft).catch(() => undefined);
      }
      redraw();
    },
    [saving],
  );
  const draft =
    shownKey === undefined ? undefined : drafts.current.get(shownKey);
  return { draft: draft ?? emptyCommitDraft, edit, clear };
}

function useRestoredDraft(
  key: string | undefined,
  message: string | undefined,
  drafts: Map<string, CommitDraft>,
  redraw: () => void,
) {
  useEffect(() => {
    if (key === undefined || drafts.has(key)) return;
    let current = true;
    readCommitDraft(key)
      .catch(() => emptyCommitDraft)
      .then((restored) => {
        if (!current || drafts.has(key)) return;
        drafts.set(
          key,
          message !== undefined && restored.subject === ""
            ? draftFromMessage(message)
            : restored,
        );
        redraw();
      });
    return () => {
      current = false;
    };
  }, [key, message, drafts, redraw]);
}

function useDebouncedSave() {
  const pending = useRef<PendingSave | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = undefined;
    if (next !== undefined)
      saveCommitDraft(next.key, next.draft).catch(() => undefined);
  }, []);
  const schedule = useCallback(
    (next: PendingSave) => {
      if (pending.current !== undefined && pending.current.key !== next.key)
        flush();
      clearTimeout(timer.current);
      pending.current = next;
      timer.current = setTimeout(flush, saveDelayMilliseconds);
    },
    [flush],
  );
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    pending.current = undefined;
  }, []);
  useEffect(() => flush, [flush]);
  return useMemo(() => ({ schedule, cancel }), [schedule, cancel]);
}
