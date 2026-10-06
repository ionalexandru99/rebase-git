import type { Action } from "#web/components/ui/action-menu.tsx";
import { usePanelFeature } from "#web/features/workspace-panel/api.ts";

export interface FileHistoryInput {
  readonly _tag: "FileHistory";
  readonly path: string;
}

export function isFileHistoryInput(input: unknown): input is FileHistoryInput {
  return (
    typeof input === "object" &&
    input !== null &&
    "_tag" in input &&
    input._tag === "FileHistory" &&
    "path" in input &&
    typeof input.path === "string" &&
    input.path !== ""
  );
}

export function fileHistoryTab(input: unknown) {
  if (!isFileHistoryInput(input)) return undefined;
  const parts = input.path.split("/");
  return {
    key: input.path,
    title: parts.at(-1) ?? input.path,
    context: parts.at(-2) ?? "",
  };
}

export function useFileHistoryAction() {
  const dispatch = usePanelFeature()?.dispatch;
  return (paths: readonly string[]): readonly Action[] => {
    const [path] = paths;
    if (dispatch === undefined || path === undefined || paths.length !== 1)
      return [];
    return [
      {
        id: "file-history",
        label: "File history",
        enabled: true,
        run: () =>
          dispatch({
            type: "open",
            kind: "history",
            input: { _tag: "FileHistory", path },
          }),
      },
    ];
  };
}
