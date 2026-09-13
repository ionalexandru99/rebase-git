import { IconArrowDown, IconArrowUp, IconTextWrap } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button } from "#web-ui/components/ui/button";
import { useWorkingChanges } from "#web-ui/features/working-changes/working-changes-provider";

export function DiffDisplayControls({
  expanded,
  onExpand,
  children,
}: {
  readonly expanded: boolean;
  readonly onExpand: (expanded: boolean) => void;
  readonly children?: ReactNode;
}) {
  const { state, controller } = useWorkingChanges();
  const prefs = state.preferences;
  const section = state.selection?.section ?? "unstaged";
  const files = state.changes?.[section] ?? [];
  const index = files.findIndex((file) => file.path === state.selection?.path);
  const previous = files[index - 1];
  const next = files[index + 1];
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
        onClick={() => controller.preferences({ ...prefs, split: false })}
      >
        Unified
      </Button>
      <Button
        size="xs"
        variant="ghost"
        aria-pressed={prefs.split}
        className="aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground"
        onClick={() => controller.preferences({ ...prefs, split: true })}
      >
        Split
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Word wrap"
        aria-pressed={prefs.wrap}
        className="aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground"
        onClick={() => controller.preferences({ ...prefs, wrap: !prefs.wrap })}
      >
        <IconTextWrap />
      </Button>
      <Button
        size="xs"
        variant="ghost"
        aria-pressed={expanded}
        className="aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground"
        onClick={() => onExpand(!expanded)}
      >
        {expanded ? "Collapse context" : "Expand context"}
      </Button>
      <div className="ml-auto flex">
        {children}
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Previous file"
          disabled={!previous}
          onClick={() => {
            if (previous) controller.select(section, previous.path);
          }}
        >
          <IconArrowUp />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Next file"
          disabled={!next}
          onClick={() => {
            if (next) controller.select(section, next.path);
          }}
        >
          <IconArrowDown />
        </Button>
      </div>
    </fieldset>
  );
}
