import type { ReactNode } from "react";
import { DiffDisplayControls as Controls } from "#web/features/file-diff/index";
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
  const section = state.selection?.section ?? "unstaged";
  const files = state.changes?.[section] ?? [];
  const index = files.findIndex((file) => file.path === state.selection?.path);
  const previous = files[index - 1];
  const next = files[index + 1];
  return (
    <Controls
      expanded={expanded}
      onExpand={onExpand}
      preferences={state.preferences}
      onPreferences={controller.preferences}
      previous={
        previous ? () => controller.select(section, previous.path) : undefined
      }
      next={next ? () => controller.select(section, next.path) : undefined}
    >
      {children}
    </Controls>
  );
}
