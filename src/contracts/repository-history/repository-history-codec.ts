import {
  RepositoryHistoryBatch,
  RepositoryHistoryPage,
} from "@rebase/contracts/repository-history/repository-history.contract";
import { Schema } from "effect";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const decodePage = Schema.decodeUnknownSync(RepositoryHistoryPage);
const decodeBatch = Schema.decodeUnknownSync(RepositoryHistoryBatch);
const decodeBatchSequence = Schema.decodeUnknownSync(
  Schema.Struct({ sequence: RepositoryHistoryBatch.fields.sequence }),
);

export function encodeRepositoryHistoryPage(page: RepositoryHistoryPage) {
  return encoder.encode(JSON.stringify(decodePage(page)));
}

export function decodeRepositoryHistoryPage(bytes: Uint8Array) {
  return decodePage(JSON.parse(decoder.decode(bytes)));
}

export function encodeRepositoryHistoryBatch(batch: RepositoryHistoryBatch) {
  return encoder.encode(JSON.stringify(decodeBatch(batch)));
}

export function decodeRepositoryHistoryBatch(bytes: Uint8Array) {
  return decodeBatch(JSON.parse(decoder.decode(bytes)));
}

export function readRepositoryHistoryBatchSequence(bytes: Uint8Array) {
  return decodeBatchSequence(JSON.parse(decoder.decode(bytes))).sequence;
}
