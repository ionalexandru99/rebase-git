import { createContext, type ReactNode, use } from "react";
import type { CommitGraphToolbarModel } from "#web/features/commit-graph/commit-graph-toolbar.contract";

const ToolbarContext = createContext<CommitGraphToolbarModel | undefined>(
  undefined,
);

export function CommitGraphToolbarProvider({
  model,
  children,
}: {
  readonly model: CommitGraphToolbarModel;
  readonly children: ReactNode;
}) {
  return <ToolbarContext value={model}>{children}</ToolbarContext>;
}

export function useCommitGraphToolbar() {
  const model = use(ToolbarContext);
  if (model === undefined)
    throw new Error("Commit graph toolbar provider is missing.");
  return model;
}
