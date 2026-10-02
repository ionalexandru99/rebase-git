import { IconList, IconListTree } from "@tabler/icons-react";
import { type JSX, useId, useState } from "react";
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

export function BranchesSidebarScopeFilter({
  onChange,
  scope,
}: {
  readonly onChange: (scope: BranchesSidebarScope) => void;
  readonly scope: BranchesSidebarScope;
}): JSX.Element {
  const name = useId();
  return (
    <div
      aria-label="Branch scope"
      className="mx-3 mt-2 mb-1.5 grid grid-cols-[.6fr_.85fr_1.1fr_.75fr_1.15fr] gap-0.5 rounded-md border border-sidebar-border/50 bg-muted/30 p-0.5"
      role="radiogroup"
    >
      {scopeOptions.map((option) => (
        <label className="min-w-0 cursor-default" key={option.value}>
          <input
            checked={scope === option.value}
            className="peer sr-only"
            name={name}
            onChange={() => onChange(option.value)}
            type="radio"
            value={option.value}
          />
          <span className="flex h-6 min-w-0 items-center justify-center rounded-sm px-1 text-[.68rem] text-muted-foreground select-none peer-checked:bg-sidebar-accent peer-checked:text-sidebar-accent-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-sidebar-ring/50">
            {option.label}
          </span>
        </label>
      ))}
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
