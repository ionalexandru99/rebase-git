import type { Icon } from "@tabler/icons-react";
import { type JSX, useId } from "react";

const groupClassName =
  "flex shrink-0 gap-0.5 rounded-md border border-sidebar-border bg-muted/30 p-0.5";
const itemClassName =
  "grid h-6 w-7 place-items-center rounded-sm text-muted-foreground";

export interface IconOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly Icon: Icon;
}

export function IconSwitch<Value extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly IconOption<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
}): JSX.Element {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className={groupClassName}>
      {options.map((option) => (
        <label key={option.value} className="relative cursor-default">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            aria-label={option.label}
            className="peer absolute inset-0 m-0 cursor-default appearance-none opacity-0"
          />
          <span
            className={`${itemClassName} peer-checked:bg-sidebar-accent peer-checked:text-sidebar-accent-foreground peer-focus-visible:ring-1 peer-focus-visible:ring-sidebar-ring`}
          >
            <option.Icon aria-hidden="true" className="size-4" />
          </span>
        </label>
      ))}
    </div>
  );
}

export interface IconToggle {
  readonly label: string;
  readonly Icon: Icon;
  readonly pressed: boolean;
  readonly onChange: (pressed: boolean) => void;
}

export function IconToggles({
  toggles,
}: {
  readonly toggles: readonly IconToggle[];
}): JSX.Element {
  return (
    <div className={groupClassName}>
      {toggles.map((toggle) => (
        <button
          key={toggle.label}
          type="button"
          aria-label={toggle.label}
          aria-pressed={toggle.pressed}
          onClick={() => toggle.onChange(!toggle.pressed)}
          className={`${itemClassName} outline-none aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring`}
        >
          <toggle.Icon aria-hidden="true" className="size-4" />
        </button>
      ))}
    </div>
  );
}
