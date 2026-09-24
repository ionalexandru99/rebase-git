import { IconArrowBarToDown, IconArrowDown } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button } from "#web-ui/components/ui/button";

interface ToolbarAction {
  readonly execute: () => void;
  readonly disabled: boolean;
}

function Frame({ children }: { readonly children: ReactNode }) {
  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-border/60 border-b px-3 py-2">
      {children}
    </header>
  );
}
function Title({ repositoryName }: { readonly repositoryName: string }) {
  return (
    <h1 className="mr-auto min-w-0 max-w-48 truncate text-[.85rem] font-semibold text-foreground">
      {repositoryName}
    </h1>
  );
}
function Fetch({
  fetchAction,
  fetching,
}: {
  readonly fetchAction: ToolbarAction;
  readonly fetching: boolean;
}) {
  return (
    <Button
      className="h-7 gap-1.5 text-[.85rem] sm:text-[.85rem]"
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
function Pull({
  pullAction,
  pulling,
  incoming,
}: {
  readonly pullAction: ToolbarAction;
  readonly pulling: boolean;
  readonly incoming: number;
}) {
  return (
    <Button
      aria-label={
        pulling
          ? "Pulling"
          : incoming > 0
            ? `Pull ${incoming} incoming ${incoming === 1 ? "commit" : "commits"}`
            : "Pull"
      }
      className="h-7 gap-1.5 text-[.85rem] sm:text-[.85rem]"
      disabled={pullAction.disabled || pulling}
      onClick={pullAction.execute}
      size="sm"
      variant="ghost"
    >
      <IconArrowBarToDown aria-hidden="true" className="size-3.5" />
      {pulling ? "Pulling" : "Pull"}
      {pulling || incoming === 0 ? null : (
        <span
          aria-hidden="true"
          className="rounded-full bg-primary/15 px-1.5 text-[.75rem] leading-[1.15rem] text-primary tabular-nums"
        >
          {incoming}
        </span>
      )}
    </Button>
  );
}
export const CommitGraphToolbar = { Frame, Title, Fetch, Pull };
