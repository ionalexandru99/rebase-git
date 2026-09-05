import {
  maximumRepositoryHistorySequence,
  ReadRepositoryHistory,
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
  it("preserves bounded foreground ancestry, offsets, and selected parent edges", () => {
    const foreground = {
      _tag: "ReadRepositoryHistory",
      ancestry: "first-parent",
      offset: 250_000,
      limit: 100,
      order: "topological",
      roots: [{ name: "main", type: "branch", oid: "a".repeat(40) }],
      additionalParentEdges: [
        { childOid: "a".repeat(40), parentOid: "b".repeat(40) },
      ],
      repositoryId: request.repositoryId,
      requestId: request.requestId,
    };
    const decode = Schema.decodeUnknownSync(ReadRepositoryHistory);
    expect(decode(foreground)).toEqual(foreground);
    expect(() => decode({ ...foreground, offset: -1 })).toThrow();
    expect(() =>
      decode({
        ...foreground,
        additionalParentEdges: Array.from(
          { length: 1_001 },
          () => foreground.additionalParentEdges[0],
        ),
      }),
    ).toThrow();
  });
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
