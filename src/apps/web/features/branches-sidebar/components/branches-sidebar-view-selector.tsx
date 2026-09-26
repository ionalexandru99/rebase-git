import { IconList, IconListTree } from "@tabler/icons-react";
import { useId } from "react";
import type { BranchesSidebarView } from "#web/features/branches-sidebar/branches-sidebar-model";

const options = [
  { value: "linear", label: "Linear view", Icon: IconList },
  { value: "tree", label: "Tree view", Icon: IconListTree },
] as const;

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
      {options.map(({ value, label, Icon }) => (
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
