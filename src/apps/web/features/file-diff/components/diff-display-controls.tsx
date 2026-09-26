import { IconArrowDown, IconArrowUp, IconTextWrap } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button } from "#web/components/ui/button";
import type { DiffPreferences } from "#web/domain/file-diff/diff-preferences.contract";

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
      className="flex shrink-0 flex-wrap items-center gap-1 border-border border-b p-2"
      aria-label="Diff display controls"
    >
      <Button
        size="xs"
        variant="ghost"
        aria-pressed={!prefs.split}
        className="aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground"
        onClick={() => onPreferences({ ...prefs, split: false })}
      >
        Unified
      </Button>
      <Button
        size="xs"
        variant="ghost"
        aria-pressed={prefs.split}
        className="aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground"
        onClick={() => onPreferences({ ...prefs, split: true })}
      >
        Split
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Word wrap"
        aria-pressed={prefs.wrap}
        className="aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground"
        onClick={() => onPreferences({ ...prefs, wrap: !prefs.wrap })}
      >
        <IconTextWrap />
      </Button>
      {onExpand ? (
        <Button
          size="xs"
          variant="ghost"
          aria-pressed={expanded}
          className="aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground"
          onClick={() => onExpand(!expanded)}
        >
          {expanded ? "Hide unchanged lines" : "Show unchanged lines"}
        </Button>
      ) : null}
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
