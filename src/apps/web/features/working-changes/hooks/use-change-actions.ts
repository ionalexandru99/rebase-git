import {
  type ChangesScope,
  type ChangesWritten,
  RepositoryChangesHttpApi,
  type ViewedChange,
} from "@rebase/contracts";
import {
  changeDiffInput,
  changesScope,
} from "#web/features/working-changes/working-changes-query";
import {
  answer,
  type CommandTarget,
  useCommand,
} from "#web/platform/query/use-command";

type WrittenScope = ChangesScope & { readonly viewed?: ViewedChange };

export function useChangeActions(target: CommandTarget) {
  const mutate = useCommand(RepositoryChangesHttpApi.mutate, {
    target,
    answers: (written, input) => changesAnswers(input, written),
  });
  const commit = useCommand(RepositoryChangesHttpApi.commit, {
    target,
    answers: (written, input) =>
      changesAnswers({ ...input, amend: false }, written),
  });
  return { mutate, commit, busy: mutate.running || commit.running };
}

function changesAnswers(scope: WrittenScope, written: ChangesWritten) {
  const changes = answer(
    RepositoryChangesHttpApi.read,
    changesScope(scope),
    written.changes,
  );
  if (scope.viewed === undefined || written.diff === null) return [changes];
  return [
    changes,
    answer(
      RepositoryChangesHttpApi.diff,
      changeDiffInput(scope, scope.viewed),
      written.diff,
      written.changes.revision,
    ),
  ];
}
