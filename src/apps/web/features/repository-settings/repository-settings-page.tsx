import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { SettingsSection } from "#web/components/ui/settings-layout";
import type { OpenProjectRepository } from "#web/features/open-project/open-project.contract";
import { RepositoryFetchSettings } from "#web/features/repository-fetch/components/repository-fetch-settings";
import { describeRepositoryFetchError } from "#web/features/repository-fetch/repository-fetch-error";
import { forgetRepositoryRefs } from "#web/features/repository-refs/repository-refs-query";
import { RepositoryCacheSettings } from "#web/features/repository-settings/components/repository-cache-settings";
import { RepositoryDetailsSettings } from "#web/features/repository-settings/components/repository-details-settings";
import { RepositoryOrderSettings } from "#web/features/repository-settings/components/repository-order-settings";
import type {
  RepositoryHistorySettingsClient,
  RepositorySettingsIdentity,
} from "#web/features/repository-settings/repository-settings.contract";
import { useStore } from "#web/platform/store/use-store";

export function RepositorySettingsPage({
  repository,
  environmentId,
  logicalRepositoryId,
  environmentName,
  reader,
  connected,
  canConfigure,
  canRemove,
  copyPath,
  reveal,
  remove,
}: {
  readonly repository: OpenProjectRepository;
  readonly environmentId: string | undefined;
  readonly logicalRepositoryId: string;
  readonly environmentName: string;
  readonly reader: RepositoryHistorySettingsClient | undefined;
  readonly connected: boolean;
  readonly canConfigure: boolean;
  readonly canRemove: boolean;
  readonly copyPath: () => Promise<void>;
  readonly reveal: (() => Promise<void>) | undefined;
  readonly remove: () => Promise<void>;
}) {
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
          {repository.name} · {environmentName}
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
        {reader === undefined || identity === undefined ? (
          <p role="status" className="mt-8 text-sm text-muted-foreground">
            {environmentId === undefined
              ? "Reconnect to load repository settings."
              : "Loading repository settings…"}
          </p>
        ) : (
          <RepositoryHistorySettings
            reader={reader}
            identity={identity}
            connected={connected}
            canConfigure={canConfigure}
          />
        )}
        <SettingsSection title="Repository">
          <RepositoryDetailsSettings
            name={repository.name}
            path={repository.path}
            connected={connected}
            canRemove={canRemove}
            copyPath={copyPath}
            reveal={reveal}
            remove={remove}
          />
        </SettingsSection>
      </div>
    </main>
  );
}

function RepositoryHistorySettings({
  reader,
  identity,
  connected,
  canConfigure,
}: {
  readonly reader: RepositoryHistorySettingsClient;
  readonly identity: RepositorySettingsIdentity;
  readonly connected: boolean;
  readonly canConfigure: boolean;
}) {
  const snapshot = useStore(reader);
  const queryClient = useQueryClient();
  const disabledReason = !connected
    ? "Reconnect to the server and try again."
    : snapshot.freshnessError !== undefined
      ? describeRepositoryFetchError(snapshot.freshnessError)
      : !canConfigure
        ? "Connect with repository write access to change fetch settings."
        : "Loading fetch settings.";
  return (
    <>
      <SettingsSection title="Fetch">
        <RepositoryFetchSettings
          reader={reader}
          setting={snapshot.freshness?.setting ?? { _tag: "Inherit" }}
          defaultIntervalSeconds={
            snapshot.freshness?.defaultIntervalSeconds ?? 300
          }
          disabled={
            !connected ||
            !canConfigure ||
            snapshot.freshness === undefined ||
            snapshot.freshnessError !== undefined
          }
          disabledReason={disabledReason}
        />
      </SettingsSection>
      <SettingsSection title="History storage">
        <RepositoryCacheSettings
          reader={reader}
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
