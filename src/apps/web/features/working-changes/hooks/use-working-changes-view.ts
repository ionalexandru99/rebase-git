import type {
  ChangeSection,
  ChangeSelection,
  ChangesScope,
  MutateChanges,
  RepositoryChanges,
  ViewedChange,
} from "@rebase/contracts";
import { useCallback, useState } from "react";
import { useDiffPreferences } from "#web/features/file-diff/index";
import {
  type ChangesRequestFailure,
  describeChangesFailure,
  headMovedMessage,
} from "#web/features/working-changes/changes-messages";
import {
  amendDraftKey,
  commitMessage,
} from "#web/features/working-changes/draft/commit-draft";
import {
  type Amend,
  amendOff,
  useAmendHead,
} from "#web/features/working-changes/hooks/use-amend";
import { useChangeActions } from "#web/features/working-changes/hooks/use-change-actions";
import { useChangeDiff } from "#web/features/working-changes/hooks/use-change-diff";
import { useChangeSelection } from "#web/features/working-changes/hooks/use-change-selection";
import { useCommitDraft } from "#web/features/working-changes/hooks/use-commit-draft";
import { useWorkingChanges } from "#web/features/working-changes/hooks/use-working-changes";
import type { CommitDraft } from "#web/persistence/working-changes/working-changes-store.contract";

export interface WorkingChangesTarget {
  readonly repositoryId: string;
  readonly worktreePath: string;
  readonly draftKey: string;
  readonly active: boolean;
}

export type ChangeAction = (
  action: MutateChanges["action"],
  section: ChangeSection,
  selection: ChangeSelection,
  revision?: string,
) => void;

export function useWorkingChangesView({
  repositoryId,
  worktreePath,
  draftKey,
  active,
}: WorkingChangesTarget) {
  const [amend, setAmend] = useState<Amend>(amendOff);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const scope: ChangesScope = { repositoryId, worktreePath, amend: amend.on };
  const read = useWorkingChanges(scope, active);
  const changes = read.isPlaceholderData ? undefined : read.data;
  const headMoved = useCallback(() => setProblem(headMovedMessage), []);
  useAmendHead(
    amend,
    setAmend,
    read.isFetching ? undefined : changes,
    headMoved,
  );
  const [selection, select] = useChangeSelection(read.data);
  const diff = useChangeDiff(scope, selection, changes, active);
  const [preferences, choosePreferences] = useDiffPreferences();
  const actions = useChangeActions({ repositoryId, worktreePath });
  const draft = useCommitDraft(
    currentDraftKey(draftKey, amend),
    amend.on ? changes?.message : undefined,
  );
  const loading =
    changes === undefined || (amend.on && amend.head === undefined);
  const busy = actions.busy;
  const begin = (): RepositoryChanges | undefined => {
    if (changes === undefined || busy || loading) return undefined;
    setProblem(null);
    setNotice(null);
    return changes;
  };
  const fail = (failure: ChangesRequestFailure) =>
    setProblem(describeChangesFailure(failure));

  const act: ChangeAction = (action, section, selected, revision) => {
    const current = begin();
    if (current === undefined) return;
    actions.mutate.mutate(
      {
        ...scope,
        ...viewing(selection),
        revision: revision ?? current.revision,
        action,
        section,
        selection: selected,
      },
      { onError: fail },
    );
  };

  const commit = () => {
    const current = begin();
    if (current === undefined) return;
    const amended = amend.on;
    actions.commit.mutate(
      {
        ...scope,
        ...viewing(selection),
        revision: current.revision,
        message: commitMessage(draft.draft),
      },
      {
        onSuccess: () => {
          draft.clear(
            amended
              ? [draftKey, amendDraftKey(draftKey, current.head)]
              : [draftKey],
          );
          setAmend(amendOff);
          setNotice(amended ? "Commit amended." : "Changes committed.");
        },
        onError: fail,
      },
    );
  };

  return {
    changes: read.data,
    diff: diff.data,
    selection,
    select,
    preferences,
    choosePreferences,
    amend: amend.on,
    toggleAmend: (on: boolean) => {
      if (begin() !== undefined) setAmend(on ? { on: true } : amendOff);
    },
    draft: draft.draft,
    editDraft: (next: CommitDraft) => {
      if (notice !== null) setNotice(null);
      draft.edit(next);
    },
    busy,
    loading,
    error:
      problem ?? (read.isError ? describeChangesFailure(read.error) : null),
    notice,
    refresh: () => {
      setProblem(null);
      void read.refetch();
    },
    act,
    commit,
  };
}

export type WorkingChangesView = ReturnType<typeof useWorkingChangesView>;

function currentDraftKey(draftKey: string, amend: Amend) {
  if (!amend.on) return draftKey;
  return amend.head === undefined
    ? undefined
    : amendDraftKey(draftKey, amend.head);
}

function viewing(selection: ViewedChange | null) {
  return selection === null ? {} : { viewed: selection };
}
