import {
  IconArrowAutofitHeight,
  IconArrowDown,
  IconArrowUp,
  IconLayoutColumns,
  IconLayoutRows,
  IconTextWrap,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { IconSwitch, IconToggles } from "#web/components/ui/icon-switch.tsx";
import type { DiffPreferences } from "#web/domain/file-diff/diff-preferences.contract.ts";

const layoutOptions = [
  { value: "unified", label: "Unified", Icon: IconLayoutRows },
  { value: "split", label: "Split", Icon: IconLayoutColumns },
] as const;

export function DiffDisplayControls({
  expanded,
  onExpand,
  children,
  preferences: prefs,
  onPreferences,
  previous,
  next,
}: {
  readonly expanded: boolean;
  readonly onExpand?: ((expanded: boolean) => void) | undefined;
  readonly children?: ReactNode;
  readonly preferences: DiffPreferences;
  readonly onPreferences: (preferences: DiffPreferences) => void;
  readonly previous?: (() => void) | undefined;
  readonly next?: (() => void) | undefined;
}) {
  return (
    <fieldset
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-border border-b p-2"
      aria-label="Diff display controls"
    >
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
      <div className="ml-auto flex">
        {children}
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Previous file"
          disabled={!previous}
          onClick={previous}
        >
          <IconArrowUp />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Next file"
          disabled={!next}
          onClick={next}
        >
          <IconArrowDown />
        </Button>
      </div>
    </fieldset>
  );
}
