import type { Action } from "#web/components/ui/action-menu.tsx";
import { usePanelFeature } from "#web/features/workspace-panel/api.ts";

export interface BlameInput {
  readonly _tag: "Blame";
  readonly path: string;
  readonly revision: string | null;
  readonly line?: number;
}

export function isBlameInput(input: unknown): input is BlameInput {
  return (
    typeof input === "object" &&
    input !== null &&
    "_tag" in input &&
    input._tag === "Blame" &&
    "path" in input &&
    typeof input.path === "string" &&
    input.path !== "" &&
    "revision" in input &&
    (input.revision === null || typeof input.revision === "string") &&
    (!("line" in input) || Number.isInteger(input.line))
  );
}

export function blameTab(input: unknown) {
  if (!isBlameInput(input)) return undefined;
  const parts = input.path.split("/");
  return {
    key: `${input.revision ?? "working"}:${input.path}`,
    title: parts.at(-1) ?? input.path,
    context: input.revision?.slice(0, 8) ?? parts.at(-2) ?? "",
  };
}

export function useBlameAction() {
  const dispatch = usePanelFeature()?.dispatch;
  return (
    paths: readonly string[],
    revision: string | null,
  ): readonly Action[] => {
    const [path] = paths;
    if (dispatch === undefined || path === undefined || paths.length !== 1)
      return [];
    return [
      {
        id: "blame",
        label: "Blame",
        enabled: true,
        run: () =>
          dispatch({
            type: "open",
            kind: "blame",
            input: { _tag: "Blame", path, revision },
          }),
      },
    ];
  };
}
