import {
  keepPreviousData,
  type QueryClient,
  skipToken,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const queryClient = useQueryClient();
  const [saveFailed, setSaveFailed] = useState(false);
  const stored = useQuery({
    queryKey: commitDraftKey(key),
    queryFn:
      key === undefined
        ? skipToken
        : () => restoreDraft(queryClient, key, message),
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: keepPreviousData,
  });
  const save = useCallback(
    (saved: string, draft: CommitDraft) =>
      saveCommitDraft(saved, draft).catch(() => setSaveFailed(true)),
    [],
  );
  const saving = useDebouncedSave(save);
  const edit = useCallback(
    (draft: CommitDraft) => {
      if (key === undefined) return;
      queryClient.setQueryData(commitDraftKey(key), draft);
      saving.schedule(key, draft);
    },
    [key, queryClient, saving],
  );
  const clear = useCallback(
    (keys: readonly string[]) => {
      saving.cancel();
      for (const cleared of keys) {
        queryClient.setQueryData(commitDraftKey(cleared), emptyCommitDraft);
        void save(cleared, emptyCommitDraft);
      }
    },
    [queryClient, save, saving],
  );
  return {
    draft: stored.data ?? emptyCommitDraft,
    edit,
    clear,
    unavailable: stored.isError || saveFailed,
  };
}

function commitDraftKey(key: string | undefined) {
  return ["commit-draft", key ?? null] as const;
}

async function restoreDraft(
  queryClient: QueryClient,
  key: string,
  message: string | undefined,
) {
  const restored = await readCommitDraft(key);
  const edited = queryClient.getQueryData<CommitDraft>(commitDraftKey(key));
  if (edited !== undefined) return edited;
  return message !== undefined && restored.subject === ""
    ? draftFromMessage(message)
    : restored;
}

function useDebouncedSave(
  save: (key: string, draft: CommitDraft) => Promise<unknown>,
) {
  const pending = useRef<PendingSave | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = undefined;
    if (next !== undefined) void save(next.key, next.draft);
  }, [save]);
  const schedule = useCallback(
    (key: string, draft: CommitDraft) => {
      if (pending.current !== undefined && pending.current.key !== key) flush();
      clearTimeout(timer.current);
      pending.current = { key, draft };
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
