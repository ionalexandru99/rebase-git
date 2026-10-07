import {
  IconAdjustmentsHorizontal,
  IconArrowAutofitHeight,
  IconLayoutColumns,
  IconLayoutRows,
  IconTextWrap,
} from "@tabler/icons-react";
import type { ReactNode, RefObject } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import {
  IconSwitch,
  type IconToggle,
  IconToggles,
} from "#web/components/ui/icon-switch.tsx";
import { ScrollTopButton } from "#web/components/ui/scroll-top-button.tsx";
import type { DiffPreferences } from "#web/domain/file-diff/diff-preferences.contract.ts";

const layoutOptions = [
  { value: "unified", label: "Unified", Icon: IconLayoutRows },
  { value: "split", label: "Split", Icon: IconLayoutColumns },
] as const;

type Layout = (typeof layoutOptions)[number]["value"];

interface DisplayOptions {
  readonly layout: Layout;
  readonly chooseLayout: (layout: Layout) => void;
  readonly toggles: readonly IconToggle[];
}

export function DiffDisplayControls({
  expanded,
  onExpand,
  preferences: prefs,
  onPreferences,
  children,
  region,
}: {
  readonly expanded: boolean;
  readonly onExpand?: ((expanded: boolean) => void) | undefined;
  readonly preferences: DiffPreferences;
  readonly onPreferences: (preferences: DiffPreferences) => void;
  readonly children?: ReactNode;
  readonly region: RefObject<HTMLElement | null>;
}) {
  const options: DisplayOptions = {
    layout: prefs.split ? "split" : "unified",
    chooseLayout: (layout) =>
      onPreferences({ ...prefs, split: layout === "split" }),
    toggles: [
      {
        label: "Word wrap",
        Icon: IconTextWrap,
        pressed: prefs.wrap,
        onChange: (wrap) => onPreferences({ ...prefs, wrap }),
      },
      ...(onExpand
        ? [
            {
              label: "Show unchanged lines",
              Icon: IconArrowAutofitHeight,
              pressed: expanded,
              onChange: onExpand,
            },
          ]
        : []),
    ],
  };
  return (
    <fieldset
      className="@container flex h-11.75 shrink-0 items-center border-border border-b px-2"
      aria-label="Diff display controls"
    >
      <div className="flex w-full items-center gap-1">
        <div className="hidden items-center gap-1 @min-[16rem]:flex">
          <IconSwitch
            label="Diff layout"
            options={layoutOptions}
            value={options.layout}
            onChange={options.chooseLayout}
          />
          <IconToggles toggles={options.toggles} />
        </div>
        <div className="flex @min-[16rem]:hidden">
          <OptionsMenu {...options} />
        </div>
        <div className="ml-auto flex items-center">
          {children}
          <ScrollTopButton region={region} />
        </div>
      </div>
    </fieldset>
  );
}

function OptionsMenu({ layout, chooseLayout, toggles }: DisplayOptions) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="icon-xs" variant="ghost" aria-label="View options" />
        }
      >
        <IconAdjustmentsHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuRadioGroup
          value={layout}
          onValueChange={(value: Layout) => chooseLayout(value)}
        >
          {layoutOptions.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <span className="flex items-center gap-2">
                <Icon aria-hidden="true" />
                {label}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {toggles.map(({ label, Icon, pressed, onChange }) => (
          <DropdownMenuCheckboxItem
            key={label}
            checked={pressed}
            onCheckedChange={onChange}
          >
            <Icon aria-hidden="true" />
            {label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
