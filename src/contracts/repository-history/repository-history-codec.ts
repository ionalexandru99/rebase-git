import {
  RepositoryHistoryBatch,
  RepositoryHistoryPage,
} from "@rebase/contracts/repository-history/repository-history.contract";
import { Schema } from "effect";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const decodePage = Schema.decodeUnknownSync(RepositoryHistoryPage);
const decodeBatch = Schema.decodeUnknownSync(RepositoryHistoryBatch);

export function repositoryHistoryPageJson(page: RepositoryHistoryPage) {
  return JSON.stringify(decodePage(page));
}

export function repositoryHistoryBatchJson(batch: RepositoryHistoryBatch) {
  return JSON.stringify(decodeBatch(batch));
}

export function encodeRepositoryHistoryPage(page: RepositoryHistoryPage) {
  return encoder.encode(repositoryHistoryPageJson(page));
}

export function decodeRepositoryHistoryPage(bytes: Uint8Array) {
  return decodePage(JSON.parse(decoder.decode(bytes)));
}

export function encodeRepositoryHistoryBatch(batch: RepositoryHistoryBatch) {
  return encoder.encode(repositoryHistoryBatchJson(batch));
}

export function decodeRepositoryHistoryBatch(bytes: Uint8Array) {
  return decodeBatch(JSON.parse(decoder.decode(bytes)));
}
