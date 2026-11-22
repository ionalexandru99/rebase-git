import { useStoredStore } from "#web/platform/store/stored-store.ts";
import { useStore } from "#web/platform/store/use-store.ts";

export interface DiffPreferences {
  readonly split: boolean;
  readonly wrap: boolean;
  readonly tree: boolean;
}

export const defaultDiffPreferences: DiffPreferences = {
  split: false,
  wrap: false,
  tree: true,
};

export function useDiffPreferences() {
  const store = useStoredStore(
    "rebase:diff-preferences:v1",
    decodeDiffPreferences,
  );
  return [useStore(store), store.set] as const;
}

function decodeDiffPreferences(saved: unknown): DiffPreferences {
  if (typeof saved !== "object" || saved === null)
    return defaultDiffPreferences;
  const read = (key: keyof DiffPreferences): boolean => {
    const stored: unknown = Reflect.get(saved, key);
    return typeof stored === "boolean" ? stored : defaultDiffPreferences[key];
  };
  return { split: read("split"), wrap: read("wrap"), tree: read("tree") };
}
