import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import {
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "#web/components/ui/settings-layout.tsx";
import { BranchSettings } from "#web/features/branch-settling/branch-settings.tsx";
import { writeClipboardText } from "#web/features/clipboard/write-clipboard-text.ts";
import { RepositoryIdentityRow } from "#web/features/git-identity/git-identity.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { forgetRepositoryRefs } from "#web/features/refs/repository-refs.ts";
import { RepositoryFetchPruneRow } from "#web/features/remote-sync/fetch-prune.tsx";
import { RepositoryFetchSettings } from "#web/features/remote-sync/fetch-settings.tsx";
import { RepositoryPullStrategyRow } from "#web/features/remote-sync/pull-strategy.tsx";
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
import { WorktreeFolderSettings } from "#web/features/worktrees/worktree-folder-settings.tsx";
import { useEnvironment } from "#web/platform/query/environment-context.tsx";
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
  const errorToast = useErrorToast();
  const logicalRepositoryId = repository?.logicalRepositoryId ?? repositoryId;
  const heading = useRef<HTMLHeadingElement>(null);
  const identity =
    environmentId === undefined
      ? undefined
      : { environmentId, repositoryId: logicalRepositoryId };
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
      <SettingsPage title="Repository settings" headingRef={heading}>
        {identity === undefined ? null : (
          <SettingsSection title="Graph · This client">
            <RepositoryOrderSettings identity={identity} />
          </SettingsSection>
        )}
        {history === undefined || identity === undefined ? (
          <p role="status" className="text-sm text-muted-foreground">
            {environmentId === undefined
              ? "Reconnect to load repository settings."
              : "Loading repository settings…"}
          </p>
        ) : (
          <RepositoryHistorySettings
            history={history}
            path={path}
            repositoryId={repositoryId}
            identity={identity}
            connected={connected}
            canConfigure={writable}
          />
        )}
        <SettingsSection title="Repository">
          <RepositoryDetailsSettings
            path={path}
            connected={connected}
            canRemove={removal.canRun}
            copyPath={() => writeClipboardText(path)}
            reveal={reveal === undefined ? undefined : () => reveal(path)}
            remove={async () => {
              const result = await removal.run({ repositoryId });
              if (result._tag === "Ok") onRemoved();
              else errorToast.failure("removeRepository", result);
            }}
          />
        </SettingsSection>
      </SettingsPage>
    </main>
  );
}

function RepositoryHistorySettings({
  history,
  path,
  repositoryId,
  identity,
  connected,
  canConfigure,
}: {
  readonly history: RepositoryHistory;
  readonly path: string;
  readonly repositoryId: string;
  readonly identity: RepositoryHistoryIdentity;
  readonly connected: boolean;
  readonly canConfigure: boolean;
}) {
  const queryClient = useQueryClient();
  return (
    <>
      <SettingsSection title="Git">
        <RepositoryIdentityRow repositoryId={repositoryId} />
        <RepositoryFetchSettings
          repositoryId={repositoryId}
          canConfigure={canConfigure}
        />
        <RepositoryFetchPruneRow repositoryId={repositoryId} />
        <WorktreeFolderSettings
          repositoryId={repositoryId}
          path={path}
          canConfigure={canConfigure}
        />
        <RepositoryPullStrategyRow repositoryId={repositoryId} />
      </SettingsSection>
      <BranchSettings
        repositoryId={repositoryId}
        path={path}
        canConfigure={canConfigure}
      />
      <SettingsSection title="History storage · This browser">
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
  const order = useRepositoryHistoryOrder(
    identity.environmentId,
    identity.repositoryId,
  );
  const errorToast = useErrorToast();
  return (
    <SettingsRow title="History ordering">
      <select
        aria-label="History ordering"
        className="h-8 rounded-md border border-input bg-input/30 px-3 text-sm"
        value={order}
        onChange={(event) => {
          const next =
            event.currentTarget.value === "chronological"
              ? "chronological"
              : "topological";
          try {
            saveRepositoryHistoryOrder(identity, next);
          } catch {
            errorToast.show("saveHistoryOrder");
          }
        }}
      >
        <option value="topological">Topological</option>
        <option value="chronological">Chronological</option>
      </select>
    </SettingsRow>
  );
}
