import { useCallback, useMemo, useState } from "react";
import type {
  ChangeSection,
  ChangeSelection,
  ChangesScope,
  MutateChanges,
  RepositoryChanges,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import { useDiffPreferences } from "#web/features/file-diff/hooks/use-diff-preferences.ts";
import {
  splitConflicts,
  useConflicts,
} from "#web/features/working-changes/conflicts/hooks/use-conflicts.ts";
import {
  type SelectedChange,
  useChangeSelection,
} from "#web/features/working-changes/hooks/use-change-selection.ts";
import {
  amendDraftKey,
  commitMessage,
  useCommitDraft,
} from "#web/features/working-changes/hooks/use-commit-draft.ts";
import {
  type Amend,
  amendOff,
  useAmendHead,
  useChangeActions,
  useChangeDiff,
  useWorkingChanges,
} from "#web/features/working-changes/hooks/use-working-changes.ts";
import type { CommitDraft } from "#web/persistence/working-changes/working-changes-store.ts";
import {
  describeFailure,
  type RequestFailure,
} from "#web/platform/query/request-failure.ts";

const headMovedMessage =
  "HEAD changed while you were amending. Review the latest commit before enabling Amend again.";

const storageUnavailableMessage =
  "Could not access changes preferences or the commit draft in this browser.";

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
  const scope: ChangesScope = { repositoryId, worktreePath, amend: amend.on };
  const read = useWorkingChanges(scope, active);
  const shown = useMemo(() => splitConflicts(read.data), [read.data]);
  const changes = read.isPlaceholderData ? undefined : shown.changes;
  const headMoved = useCallback(() => setProblem(headMovedMessage), []);
  const [selection, select] = useChangeSelection(
    shown.changes,
    shown.conflicted,
  );
  const diff = useChangeDiff(scope, selection, changes, active);
  const conflicts = useConflicts(
    { repositoryId, worktreePath },
    shown.conflicted,
    selection?.section === "conflicts" ? selection.path : null,
    active,
  );
  const [preferences, choosePreferences] = useDiffPreferences();
  const actions = useChangeActions({ repositoryId, worktreePath });
  useAmendHead(
    amend,
    setAmend,
    read.isFetching || actions.busy ? undefined : changes,
    headMoved,
  );
  const draft = useCommitDraft(
    currentDraftKey(draftKey, amend),
    amend.on ? changes?.message : undefined,
  );
  const loading =
    changes === undefined || (amend.on && amend.head === undefined);
  const busy = actions.busy || conflicts.busy;
  const begin = (): RepositoryChanges | undefined => {
    if (changes === undefined || busy || loading) return undefined;
    setProblem(null);
    return changes;
  };
  const fail = (failure: RequestFailure<{ readonly _tag: string }>) =>
    setProblem(describeFailure(failure));

  const act: ChangeAction = async (action, section, selected, revision) => {
    const current = begin();
    if (current === undefined) return;
    const result = await actions.mutate.run({
      amend: scope.amend,
      ...viewing(selection),
      revision: revision ?? current.revision,
      action,
      section,
      selection:
        shown.conflicted.length > 0
          ? listedOnly(current, section, selected)
          : selected,
    });
    if (result._tag !== "Ok") fail(result);
  };

  const commit = async () => {
    const current = begin();
    if (current === undefined) return;
    const amended = amend.on;
    const result = await actions.commit.run({
      amend: amended,
      ...viewing(selection),
      revision: current.revision,
      message: commitMessage(draft.draft),
    });
    if (result._tag !== "Ok") return fail(result);
    draft.clear(
      amended ? [draftKey, amendDraftKey(draftKey, current.head)] : [draftKey],
    );
    setAmend(amendOff);
  };

  return {
    changes: shown.changes,
    conflicts,
    diff: diff.data,
    selection,
    select,
    preferences,
    choosePreferences,
    amend: amend.on,
    toggleAmend: (on: boolean) => {
      if (!on) {
        if (!busy) setAmend(amendOff);
      } else if (begin() !== undefined) setAmend({ on: true });
    },
    draft: draft.draft,
    editDraft: (next: CommitDraft) => draft.edit(next),
    busy,
    loading,
    error:
      problem ??
      conflicts.problem ??
      (read.isError ? describeFailure(read.error) : null) ??
      (diff.isError ? describeFailure(diff.error) : null) ??
      (draft.unavailable ? storageUnavailableMessage : null),
    refresh: () => {
      setProblem(null);
      void read.refetch();
      if (diff.isError) void diff.refetch();
      conflicts.refresh();
      draft.retry();
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

function viewing(selection: SelectedChange | null) {
  return selection === null || selection.section === "conflicts"
    ? {}
    : { viewed: selection };
}

function listedOnly(
  changes: RepositoryChanges,
  section: ChangeSection,
  selection: ChangeSelection,
): ChangeSelection {
  return selection._tag === "All"
    ? { _tag: "Files", paths: changes[section].map((file) => file.path) }
    : selection;
}
