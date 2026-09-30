import type { ReactElement } from "react";
import {
  ActionMenuItems,
  replaceRuns,
} from "#web/components/ui/action-menu.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu.tsx";
import {
  refActions,
  requestRefIntent,
} from "#web/features/refs/ref-actions.ts";
import { useScopedRepositoryRefs } from "#web/features/refs/repository-refs.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";

const ignored = () => undefined;

export function TagLabelMenu({
  name,
  children,
}: {
  readonly name: string;
  readonly children: ReactElement;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        onContextMenu={(event) => event.stopPropagation()}
        render={children}
      />
      <ContextMenuContent className="w-max min-w-64 max-w-md">
        <TagLabelActions name={name} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function TagLabelActions({ name }: { readonly name: string }) {
  const scope = useRepositoryScope();
  const { refs } = useScopedRepositoryRefs();
  if (scope === undefined || refs === undefined) return null;
  const target = { _tag: "Tag", name } as const;
  const actions = replaceRuns(
    refActions(
      { id: name, name, target },
      refs,
      { activeWorktreePath: scope.worktreePath, writable: scope.writable },
      {
        checkout: ignored,
        pull: undefined,
        pushTags: { pushing: false, run: ignored },
        editing: {
          draft: ignored,
          startRename: ignored,
          deletion: { request: ignored },
        },
      },
    ),
    (action) => () =>
      requestRefIntent({ _tag: "RunRefAction", target, id: action.id }),
  );
  return <ActionMenuItems actions={actions} />;
}
