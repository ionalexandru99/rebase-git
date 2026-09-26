import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DiffPreferences,
  defaultDiffPreferences,
} from "#web/domain/file-diff/diff-preferences.contract";
import {
  readDiffPreferences,
  saveDiffPreferences,
} from "#web/persistence/working-changes/working-changes-store";

export function useDiffPreferences() {
  const [preferences, setPreferences] = useState(defaultDiffPreferences);
  const chosen = useRef(false);
  useEffect(() => {
    let current = true;
    readDiffPreferences().then(
      (restored) => {
        if (current && !chosen.current) setPreferences(restored);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);
  const choose = useCallback((next: DiffPreferences) => {
    chosen.current = true;
    setPreferences(next);
    saveDiffPreferences(next).catch(() => undefined);
  }, []);
  return [preferences, choose] as const;
}
