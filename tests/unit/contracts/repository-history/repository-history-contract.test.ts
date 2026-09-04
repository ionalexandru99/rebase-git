import {
  maximumRepositoryHistorySequence,
  SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

const request = {
  _tag: "SynchronizeRepositoryHistory",
  basis: {
    _tag: "Incomplete",
    committedCommitCount: 1,
    nextBatchSequence: maximumRepositoryHistorySequence,
    objectFormat: "sha1",
    rootOids: ["a".repeat(40)],
    snapshotId: "b".repeat(64),
  },
  priority: "visible",
  repositoryId: "00000000-0000-4000-8000-000000000001",
  requestId: "00000000-0000-4000-8000-000000000011",
} as const;

describe("repository history contract", () => {
  it("bounds resumable batch sequences to the unsigned wire range", () => {
    expect(
      Schema.decodeUnknownSync(SynchronizeRepositoryHistory)(request),
    ).toEqual(request);
    expect(() =>
      Schema.decodeUnknownSync(SynchronizeRepositoryHistory)({
        ...request,
        basis: {
          ...request.basis,
          nextBatchSequence: maximumRepositoryHistorySequence + 1,
        },
      }),
    ).toThrow();
  });
});
