import { IconArrowDown } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { RepositoryFetchAction } from "#web/features/repository-history/freshness/repository-fetch-action.contract";
import { Button } from "#web-ui/components/ui/button";

function Frame({ children }: { readonly children: ReactNode }) {
  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-border/60 border-b px-3 py-2">
      {children}
    </header>
  );
}
function Title({ repositoryName }: { readonly repositoryName: string }) {
  return (
    <h1 className="mr-auto min-w-0 max-w-48 truncate text-[13px] font-semibold text-foreground">
      {repositoryName}
    </h1>
  );
}
function Fetch({
  fetchAction,
  fetching,
}: {
  readonly fetchAction: RepositoryFetchAction;
  readonly fetching: boolean;
}) {
  return (
    <Button
      aria-keyshortcuts={fetchAction.ariaKeyShortcuts}
      className="h-7 gap-1.5 text-xs"
      disabled={fetchAction.disabled || fetching}
      onClick={fetchAction.execute}
      size="sm"
      variant="ghost"
    >
      <IconArrowDown aria-hidden="true" className="size-3.5" />
      {fetching ? "Fetching" : "Fetch"}
    </Button>
  );
}
export const CommitGraphToolbar = { Frame, Title, Fetch };
