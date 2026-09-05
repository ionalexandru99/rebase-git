import { useState } from "react";
import { useRepositoryHistoryOrder } from "#web/features/repository-settings/hooks/use-repository-history-order";
import { saveRepositoryHistoryOrder } from "#web/features/repository-settings/preferences/repository-history-order";
import type { RepositorySettingsIdentity } from "#web/features/repository-settings/repository-settings.contract";
import { SettingsRow } from "#web-ui/features/settings/components/settings-layout";

export function RepositoryOrderSettings({
  identity,
}: {
  readonly identity: RepositorySettingsIdentity;
}) {
  const order = useRepositoryHistoryOrder(
    identity.environmentId,
    identity.repositoryId,
  );
  const [error, setError] = useState(false);
  return (
    <>
      <SettingsRow
        title="History ordering"
        description="Saved for this repository in this client."
      >
        <select
          aria-label="History ordering"
          className="h-8 rounded-md border border-input bg-background px-3 text-sm"
          value={order}
          onChange={(event) => {
            try {
              saveRepositoryHistoryOrder(
                identity,
                event.currentTarget.value === "chronological"
                  ? "chronological"
                  : "topological",
              );
              setError(false);
            } catch {
              setError(true);
            }
          }}
        >
          <option value="topological">Topological</option>
          <option value="chronological">Chronological</option>
        </select>
      </SettingsRow>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not save history ordering. Check this client's storage and try
          again.
        </p>
      ) : null}
    </>
  );
}
