import { useOpenedHistory } from "#web/app/shell/opened-history-context";
import { useCatalogRepository } from "#web/features/repository-catalog/hooks/use-repository-catalog";
import { useRepositoryHistoryReader } from "#web/features/repository-history/hooks/use-repository-history-reader";
import type { RepositoryHistoryGateway } from "#web/features/repository-history/repository-history-reader";
import { RepositorySettingsPage } from "#web/features/repository-settings/repository-settings-page";
import { useEnvironment } from "#web/platform/query/environment-context";
import { useRepositoryScope } from "#web/platform/query/repository-scope";

export function RepositorySettingsView({
  gateway,
  repositoryId,
  reveal,
  onRemoved,
}: {
  readonly gateway: RepositoryHistoryGateway;
  readonly repositoryId: string;
  readonly reveal: ((path: string) => Promise<void>) | undefined;
  readonly onRemoved: () => void;
}) {
  const { environmentId } = useEnvironment();
  const reader = useSettingsHistoryReader(gateway, repositoryId);
  return (
    <RepositorySettingsPage
      key={JSON.stringify([environmentId, repositoryId])}
      repositoryId={repositoryId}
      reader={reader}
      reveal={reveal}
      onRemoved={onRemoved}
    />
  );
}

function useSettingsHistoryReader(
  gateway: RepositoryHistoryGateway,
  repositoryId: string,
) {
  const { environmentId } = useEnvironment();
  const repository = useCatalogRepository(repositoryId);
  const logicalRepositoryId = repository?.logicalRepositoryId ?? repository?.id;
  const opened = useOpenedHistory();
  const scope = useRepositoryScope();
  const shared =
    logicalRepositoryId !== undefined &&
    scope?.logicalRepositoryId === logicalRepositoryId;
  const own = useRepositoryHistoryReader(
    gateway,
    environmentId,
    shared ? undefined : repository?.id,
    shared ? undefined : logicalRepositoryId,
  );
  return shared ? opened?.reader : own;
}
