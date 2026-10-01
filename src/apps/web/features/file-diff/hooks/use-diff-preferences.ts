import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DiffPreferences,
  defaultDiffPreferences,
} from "#web/domain/file-diff/diff-preferences.contract.ts";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import {
  readDiffPreferences,
  saveDiffPreferences,
} from "#web/persistence/working-changes/working-changes-store.ts";

export function useDiffPreferences() {
  const [preferences, setPreferences] = useState(defaultDiffPreferences);
  const errorToast = useErrorToast();
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
  const choose = useCallback(
    (next: DiffPreferences) => {
      chosen.current = true;
      setPreferences(next);
      saveDiffPreferences(next).catch(() =>
        errorToast.show(
          "saveDiffSettings",
          "The setting applies until you reload Rebase.",
        ),
      );
    },
    [errorToast],
  );
  return [preferences, choose] as const;
}
