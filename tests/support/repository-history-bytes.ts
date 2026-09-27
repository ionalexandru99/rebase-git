import {
  type RepositoryHistoryBatch,
  type RepositoryHistoryPage,
  repositoryHistoryBatchJson,
  repositoryHistoryPageJson,
} from "@rebase/contracts";

const encoder = new TextEncoder();

export function encodeRepositoryHistoryPage(page: RepositoryHistoryPage) {
  return encoder.encode(repositoryHistoryPageJson(page));
}

export function encodeRepositoryHistoryBatch(batch: RepositoryHistoryBatch) {
  return encoder.encode(repositoryHistoryBatchJson(batch));
}
