import {
  IconChevronDown,
  IconList,
  IconListTree,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { type JSX, type KeyboardEvent, useId, useRef, useState } from "react";
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

const viewOptions = [
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

export function BranchesSidebarViewSelector({
  view,
  onChange,
}: {
  readonly view: BranchesSidebarView;
  readonly onChange: (view: BranchesSidebarView) => void;
}) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label="Branch view"
      className="flex shrink-0 gap-0.5 rounded-md border border-sidebar-border bg-muted/30 p-0.5"
    >
      {viewOptions.map(({ value, label, Icon }) => (
        <label key={value} className="cursor-default">
          <input
            type="radio"
            name={name}
            value={value}
            checked={view === value}
            onChange={() => onChange(value)}
            aria-label={label}
            className="peer sr-only"
          />
          <span className="grid h-6 w-7 place-items-center rounded-sm text-muted-foreground peer-checked:bg-sidebar-accent peer-checked:text-sidebar-accent-foreground peer-focus-visible:ring-1 peer-focus-visible:ring-sidebar-ring">
            <Icon aria-hidden="true" className="size-4" />
          </span>
        </label>
      ))}
    </div>
  );
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
    <div className="relative mx-3 mt-3 mb-2">
      <IconSearch
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        aria-label="Filter branches"
        className={`pl-9 ${query === "" ? "pr-20" : "pr-26"}`}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Filter branches"
        ref={inputRef}
        value={query}
      />
      <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
        {query === "" ? null : (
          <Button
            aria-label="Clear filter"
            className="text-muted-foreground"
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
            className="inline-flex h-6 items-center gap-0.5 rounded-sm px-1.5 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 data-popup-open:bg-accent data-popup-open:text-foreground"
          >
            {scopeLabel}
            <IconChevronDown aria-hidden="true" className="size-3" />
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
