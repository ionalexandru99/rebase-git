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
import { IconSwitch, IconToggles } from "#web/components/ui/icon-switch.tsx";
import { ScrollTopButton } from "#web/components/ui/scroll-top-button.tsx";
import type { DiffPreferences } from "#web/domain/file-diff/diff-preferences.contract.ts";

const layoutOptions = [
  { value: "unified", label: "Unified", Icon: IconLayoutRows },
  { value: "split", label: "Split", Icon: IconLayoutColumns },
] as const;

interface DisplayOptions {
  readonly expanded: boolean;
  readonly onExpand?: ((expanded: boolean) => void) | undefined;
  readonly preferences: DiffPreferences;
  readonly onPreferences: (preferences: DiffPreferences) => void;
}

export function DiffDisplayControls({
  children,
  region,
  ...options
}: DisplayOptions & {
  readonly children?: ReactNode;
  readonly region: RefObject<HTMLElement | null>;
}) {
  return (
    <fieldset
      className="@container flex h-11.75 shrink-0 items-center border-border border-b px-2"
      aria-label="Diff display controls"
    >
      <div className="flex w-full items-center gap-1">
        <div className="hidden items-center gap-1 @min-[14.5rem]:flex">
          <InlineOptions {...options} />
        </div>
        <div className="flex @min-[14.5rem]:hidden">
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

function InlineOptions({
  expanded,
  onExpand,
  preferences: prefs,
  onPreferences,
}: DisplayOptions) {
  return (
    <>
      <IconSwitch
        label="Diff layout"
        options={layoutOptions}
        value={prefs.split ? "split" : "unified"}
        onChange={(layout) =>
          onPreferences({ ...prefs, split: layout === "split" })
        }
      />
      <IconToggles
        toggles={[
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
        ]}
      />
    </>
  );
}

function OptionsMenu({
  expanded,
  onExpand,
  preferences: prefs,
  onPreferences,
}: DisplayOptions) {
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
          value={prefs.split ? "split" : "unified"}
          onValueChange={(layout) =>
            onPreferences({ ...prefs, split: layout === "split" })
          }
        >
          {layoutOptions.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              className="text-xs"
            >
              <span className="flex items-center gap-2">
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={prefs.wrap}
          closeOnClick={false}
          onCheckedChange={(wrap) => onPreferences({ ...prefs, wrap })}
        >
          <IconTextWrap />
          Word wrap
        </DropdownMenuCheckboxItem>
        {onExpand ? (
          <DropdownMenuCheckboxItem
            checked={expanded}
            closeOnClick={false}
            onCheckedChange={onExpand}
          >
            <IconArrowAutofitHeight />
            Show unchanged lines
          </DropdownMenuCheckboxItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
