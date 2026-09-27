import { openRepositoryHistory } from "#web/features/repository-history/repository-history.ts";

const parameters = new URLSearchParams(location.search);
const repositoryId = parameters.get("repository") ?? "";

openRepositoryHistory({
  environmentId: parameters.get("environment") ?? "",
  repositoryId,
  logicalRepositoryId: repositoryId,
});
