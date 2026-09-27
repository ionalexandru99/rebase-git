import { openRepositoryHistory } from "#web/features/repository-history/repository-history";

const parameters = new URLSearchParams(location.search);
const repositoryId = parameters.get("repository") ?? "";

openRepositoryHistory({
  environmentId: parameters.get("environment") ?? "",
  repositoryId,
  logicalRepositoryId: repositoryId,
});
