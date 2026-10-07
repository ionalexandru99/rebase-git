import type { Action } from "#web/components/ui/action-menu.tsx";
import { usePanelFeature } from "#web/features/workspace-panel/api.ts";

export interface ShowChangeInput {
  readonly _tag: "ShowChange";
  readonly path: string;
}

export function isShowChangeInput(input: unknown): input is ShowChangeInput {
  return (
    typeof input === "object" &&
    input !== null &&
    "_tag" in input &&
    input._tag === "ShowChange" &&
    "path" in input &&
    typeof input.path === "string" &&
    input.path !== ""
  );
}

export function useShowChangeAction() {
  const dispatch = usePanelFeature()?.dispatch;
  return (path: string): Action => ({
    id: "showChanges",
    label: "Show changes",
    enabled: dispatch !== undefined,
    run: () => {
      dispatch?.({
        type: "input",
        kind: "changes",
        input: { _tag: "ShowChange", path },
      });
      dispatch?.({ type: "open", kind: "changes" });
    },
  });
}
