import type { ReactNode } from "react";
import { DiffDisplayControls as Controls } from "#web/features/file-diff/index";
import {
  useWorkingChanges,
  useWorkingChangesController,
} from "#web-ui/features/working-changes/working-changes-provider";
export function DiffDisplayControls({
  expanded,
  onExpand,
  children,
}: {
  readonly expanded: boolean;
  readonly onExpand?: ((expanded: boolean) => void) | undefined;
  readonly children?: ReactNode;
}) {
  const controller = useWorkingChangesController();
  const selection = useWorkingChanges("selection");
  const changes = useWorkingChanges("changes");
  const preferences = useWorkingChanges("preferences");
  const section = selection?.section ?? "unstaged";
  const files = changes?.[section] ?? [];
  const index = files.findIndex((file) => file.path === selection?.path);
  const previous = files[index - 1];
  const next = files[index + 1];
  return (
    <Controls
      expanded={expanded}
      onExpand={onExpand}
      preferences={preferences}
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
