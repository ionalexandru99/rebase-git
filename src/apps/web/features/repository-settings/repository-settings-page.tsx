import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import {
  SettingsRow,
  SettingsSection,
} from "#web/components/ui/settings-layout.tsx";
import { writeClipboardText } from "#web/features/clipboard/write-clipboard-text.ts";
import { localEnvironment } from "#web/features/project-navigation/local-environment.ts";
import { forgetRepositoryRefs } from "#web/features/refs/repository-refs.ts";
import { RepositoryFetchSettings } from "#web/features/remote-sync/fetch-settings.tsx";
import {
  catalogWithout,
  useCatalogRepository,
} from "#web/features/repository-catalog/use-repository-catalog.ts";
import {
  type RepositoryHistoryIdentity,
  saveRepositoryHistoryOrder,
  useRepositoryHistoryOrder,
} from "#web/features/repository-history/history-order.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import { RepositoryCacheSettings } from "#web/features/repository-settings/components/repository-cache-settings.tsx";
import { RepositoryDetailsSettings } from "#web/features/repository-settings/components/repository-details-settings.tsx";
import { useEnvironment } from "#web/platform/query/environment-context.tsx";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { useCommand } from "#web/platform/query/use-command.ts";

export function RepositorySettingsPage({
  repositoryId,
  history,
  reveal,
  onRemoved,
}: {
  readonly repositoryId: string;
  readonly history: RepositoryHistory | undefined;
  readonly reveal: ((path: string) => Promise<void>) | undefined;
  readonly onRemoved: () => void;
}) {
  const repository = useCatalogRepository(repositoryId);
  const { environmentId, connected, writable } = useEnvironment();
  const removal = useCommand(RepositoryCatalogApi.remove, {
    answers: catalogWithout,
  });
  const logicalRepositoryId = repository?.logicalRepositoryId ?? repositoryId;
  const heading = useRef<HTMLHeadingElement>(null);
  const identity = useMemo(
    () =>
      environmentId === undefined
        ? undefined
        : { environmentId, repositoryId: logicalRepositoryId },
    [environmentId, logicalRepositoryId],
  );
  useEffect(() => {
    heading.current?.focus();
  }, []);
  if (repository === undefined) return null;
  const path = repository.path;
  return (
    <main
      aria-label="Repository settings"
      className="h-full overflow-y-auto bg-repository"
    >
      <header className="flex h-12 items-center border-b border-border/60 px-6 text-xs">
        <span>
          {repository.name}
          <span className="text-muted-foreground"> / Settings</span>
        </span>
      </header>
      <div className="mx-auto max-w-4xl px-4 pt-8 pb-16 sm:px-8">
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-xl font-semibold tracking-tight outline-none"
        >
          Repository settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {repository.name} · {localEnvironment.name}
        </p>
        <SettingsSection title="History">
          {identity === undefined ? (
            <p className="text-sm text-muted-foreground">
              Connect to the environment to load repository preferences.
            </p>
          ) : (
            <RepositoryOrderSettings identity={identity} />
          )}
        </SettingsSection>
        {history === undefined || identity === undefined ? (
          <p role="status" className="mt-8 text-sm text-muted-foreground">
            {environmentId === undefined
              ? "Reconnect to load repository settings."
              : "Loading repository settings…"}
          </p>
        ) : (
          <RepositoryHistorySettings
            history={history}
            repositoryId={repositoryId}
            identity={identity}
            connected={connected}
            canConfigure={writable}
          />
        )}
        <SettingsSection title="Repository">
          <RepositoryDetailsSettings
            name={repository.name}
            path={path}
            connected={connected}
            canRemove={removal.canRun}
            copyPath={() => writeClipboardText(path)}
            reveal={reveal === undefined ? undefined : () => reveal(path)}
            remove={async () => {
              const result = await removal.run({ repositoryId });
              if (result._tag !== "Ok")
                throw new Error(describeFailure(result));
              onRemoved();
            }}
          />
        </SettingsSection>
      </div>
    </main>
  );
}

function RepositoryHistorySettings({
  history,
  repositoryId,
  identity,
  connected,
  canConfigure,
}: {
  readonly history: RepositoryHistory;
  readonly repositoryId: string;
  readonly identity: RepositoryHistoryIdentity;
  readonly connected: boolean;
  readonly canConfigure: boolean;
}) {
  const queryClient = useQueryClient();
  return (
    <>
      <SettingsSection title="Fetch">
        <RepositoryFetchSettings
          repositoryId={repositoryId}
          canConfigure={canConfigure}
        />
      </SettingsSection>
      <SettingsSection title="History storage">
        <RepositoryCacheSettings
          history={history}
          identity={identity}
          connected={connected}
          onCacheChanged={() =>
            forgetRepositoryRefs(
              queryClient,
              identity.environmentId,
              identity.repositoryId,
            )
          }
        />
      </SettingsSection>
    </>
  );
}

function RepositoryOrderSettings({
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
