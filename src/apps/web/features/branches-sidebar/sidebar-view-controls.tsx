import {
  IconChevronDown,
  IconList,
  IconListTree,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { type JSX, type KeyboardEvent, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { Input } from "#web/components/ui/input.tsx";
import type {
  BranchesSidebarScope,
  BranchesSidebarView,
} from "#web/features/branches-sidebar/branches-sidebar-state.ts";

const viewStorageKey = "rebase:branches-view:v1";

export const branchViewOptions = [
  { value: "linear", label: "Linear view", Icon: IconList },
  { value: "tree", label: "Tree view", Icon: IconListTree },
] as const;

const scopeOptions: readonly {
  readonly label: string;
  readonly value: BranchesSidebarScope;
}[] = [
  { label: "All", value: "all" },
  { label: "Local", value: "local" },
  { label: "Remote", value: "remote" },
  { label: "Tags", value: "tags" },
  { label: "Stashes", value: "stashes" },
];

export function useBranchesSidebarView() {
  const [view, setView] = useState<BranchesSidebarView>(readView);
  const changeView = (next: BranchesSidebarView) => {
    setView(next);
    try {
      localStorage.setItem(viewStorageKey, next);
    } catch {
      return;
    }
  };
  return [view, changeView] as const;
}

export function BranchesSidebarFilter({
  onKeyDown,
  onQueryChange,
  onScopeChange,
  query,
  scope,
}: {
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly onQueryChange: (query: string) => void;
  readonly onScopeChange: (scope: BranchesSidebarScope) => void;
  readonly query: string;
  readonly scope: BranchesSidebarScope;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const scopeLabel =
    scopeOptions.find((option) => option.value === scope)?.label ?? "All";
  return (
    <div className="flex h-8.5 min-w-0 flex-1 items-center gap-0.5 overflow-hidden rounded-control border border-input bg-field pr-1 pl-3 transition-colors has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring/30 sm:h-7.5">
      <IconSearch
        aria-hidden="true"
        className="pointer-events-none size-4 shrink-0 text-muted-foreground"
      />
      <Input
        aria-label="Filter branches"
        className="h-full min-w-0 flex-1 border-0 bg-transparent px-1.5 focus-visible:ring-0 sm:h-full dark:bg-transparent"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Filter branches"
        ref={inputRef}
        value={query}
      />
      {query === "" ? null : (
        <Button
          aria-label="Clear filter"
          className="shrink-0 text-muted-foreground"
          onClick={() => {
            onQueryChange("");
            inputRef.current?.focus();
          }}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <IconX aria-hidden="true" />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Branch scope, ${scopeLabel}`}
          className="inline-flex h-6 min-w-6 items-center gap-0.5 rounded-control px-1.5 text-meta text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 data-popup-open:bg-accent data-popup-open:text-foreground"
        >
          <span className="truncate">{scopeLabel}</span>
          <IconChevronDown aria-hidden="true" className="size-3 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-36">
          <DropdownMenuRadioGroup onValueChange={onScopeChange} value={scope}>
            {scopeOptions.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function readView(): BranchesSidebarView {
  try {
    return localStorage.getItem(viewStorageKey) === "linear"
      ? "linear"
      : "tree";
  } catch {
    return "tree";
  }
}
