import { useCatalogRepository } from "#web/features/repository-catalog/use-repository-catalog";
import { useRepositoryHistory } from "#web/features/repository-history/repository-history";
import { RepositorySettingsPage } from "#web/features/repository-settings/repository-settings-page";
import { useEnvironment } from "#web/platform/query/environment-context";

export function RepositorySettingsView({
  repositoryId,
  reveal,
  onRemoved,
}: {
  readonly repositoryId: string;
  readonly reveal: ((path: string) => Promise<void>) | undefined;
  readonly onRemoved: () => void;
}) {
  const { environmentId } = useEnvironment();
  const repository = useCatalogRepository(repositoryId);
  const history = useRepositoryHistory(
    environmentId === undefined || repository === undefined
      ? undefined
      : {
          environmentId,
          repositoryId: repository.id,
          logicalRepositoryId: repository.logicalRepositoryId ?? repository.id,
        },
  );
  return (
    <RepositorySettingsPage
      key={JSON.stringify([environmentId, repositoryId])}
      repositoryId={repositoryId}
      history={history}
      reveal={reveal}
      onRemoved={onRemoved}
    />
  );
}
