import { Select } from "@base-ui/react/select";
import { IconChevronDown } from "@tabler/icons-react";

export interface SettingsSelectOption<Value extends string> {
  readonly label: string;
  readonly value: Value;
}

export function SettingsSelect<Value extends string>({
  label,
  options,
  value,
  disabled = false,
  onValueChange,
}: {
  readonly label: string;
  readonly options: readonly SettingsSelectOption<Value>[];
  readonly value: Value;
  readonly disabled?: boolean;
  readonly onValueChange: (value: Value) => void;
}) {
  return (
    <Select.Root
      disabled={disabled}
      items={options}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      value={value}
    >
      <Select.Trigger
        aria-label={label}
        className="flex h-8 w-40 shrink-0 items-center justify-between rounded-control border border-input bg-input/30 px-3 text-control text-foreground outline-none hover:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-40 data-pressed:bg-accent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <Select.Value />
        <Select.Icon>
          <IconChevronDown
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          align="end"
          alignItemWithTrigger={false}
          className="z-110 outline-none"
          sideOffset={4}
        >
          <Select.Popup className="w-[var(--anchor-width)] overflow-hidden elevation-menu p-1 outline-none">
            <Select.List>
              {options.map((option) => (
                <Select.Item
                  className="flex h-8 cursor-default items-center rounded-control px-2 text-body outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  key={option.value}
                  value={option.value}
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
