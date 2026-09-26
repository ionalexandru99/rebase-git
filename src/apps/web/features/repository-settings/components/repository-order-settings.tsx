import { useId, useState } from "react";
import { SettingsRow } from "#web/components/ui/settings-layout";
import { useRepositoryHistoryOrder } from "#web/features/repository-history/hooks/use-repository-history-order";
import {
  type RepositoryHistoryIdentity,
  saveRepositoryHistoryOrder,
} from "#web/features/repository-history/preferences/repository-history-order";

export function RepositoryOrderSettings({
  identity,
}: {
  readonly identity: RepositoryHistoryIdentity;
}) {
  const descriptionId = useId();
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
        descriptionId={descriptionId}
      >
        <select
          aria-label="History ordering"
          aria-describedby={descriptionId}
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
