import { type JSX, useId } from "react";
import type { BranchesSidebarScope } from "#web/features/branches-sidebar/branches-sidebar.contract";

const scopeOptions: readonly {
  readonly label: string;
  readonly value: BranchesSidebarScope;
}[] = [
  { label: "All", value: "all" },
  { label: "Local", value: "local" },
  { label: "Remote", value: "remote" },
  { label: "Tags", value: "tags" },
];

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
      className="mx-3 mt-2 mb-1.5 grid grid-cols-[.72fr_1fr_1.34fr_.9fr] gap-0.5 rounded-md border border-sidebar-border/50 bg-muted/30 p-0.5"
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
