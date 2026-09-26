import {
  type RepositoryRefs,
  type RepositoryTag,
  RepositoryTagsHttpApi,
} from "@rebase/contracts";
import { useApplyToRefs } from "#web/features/repository-refs/hooks/use-apply-to-refs";
import { useRepositoryScope } from "#web/features/repository-scope/repository-scope-provider";
import {
  type CommandFailure,
  settleCommand,
  useCommand,
} from "#web/platform/query/use-command";

type TagRoute =
  (typeof RepositoryTagsHttpApi)[keyof typeof RepositoryTagsHttpApi];

export type TagCommandFailure = CommandFailure<TagRoute>;

export type TagCommands = NonNullable<ReturnType<typeof useTagCommands>>;

export function useTagCommands() {
  const scope = useRepositoryScope();
  const applyToRefs = useApplyToRefs();
  const create = useCommand(RepositoryTagsHttpApi.create, {
    repository: scope,
    onSuccess: (tag) => applyToRefs((refs) => withTag(refs, tag)),
  });
  const remove = useCommand(RepositoryTagsHttpApi.delete, {
    repository: scope,
    onSuccess: ({ name }) => applyToRefs((refs) => withoutTag(refs, name)),
  });
  if (scope === undefined || !scope.writable) return null;
  const { repositoryId, worktreePath } = scope;
  return {
    create: (name: string, target: string) =>
      settleCommand(RepositoryTagsHttpApi.create, create.mutateAsync, {
        repositoryId,
        worktreePath,
        name,
        target,
      }),
    delete: (name: string) =>
      settleCommand(RepositoryTagsHttpApi.delete, remove.mutateAsync, {
        repositoryId,
        worktreePath,
        name,
      }),
  };
}

function withTag(refs: RepositoryRefs, tag: RepositoryTag): RepositoryRefs {
  return { ...refs, tags: [tag, ...withoutTag(refs, tag.name).tags] };
}

function withoutTag(refs: RepositoryRefs, name: string): RepositoryRefs {
  return { ...refs, tags: refs.tags.filter((tag) => tag.name !== name) };
}
