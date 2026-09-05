import {
  createJsonMessageReassembler,
  decodeRepositoryHistoryBatch,
  decodeRepositoryHistoryPage,
  encodeRepositoryHistoryBatch,
  encodeRepositoryHistoryPage,
  fragmentJsonMessage,
  JsonMessageFragment,
  maximumRepositoryHistorySequence,
  type RepositoryHistoryPage,
  readRepositoryHistoryBatchSequence,
} from "@rebase/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

const requestId = "00000000-0000-4000-8000-000000000011";
const repositoryId = "00000000-0000-4000-8000-000000000001";

describe("repository history JSON codec", () => {
  it("encodes pages and batches as readable JSON", () => {
    const page = historyPage("sha1");
    const parse = (bytes: Uint8Array) =>
      JSON.parse(new TextDecoder().decode(bytes));
    expect(parse(encodeRepositoryHistoryPage(page))).toEqual(page);
    expect(
      parse(
        encodeRepositoryHistoryBatch({
          commits: page.commits,
          objectFormat: page.objectFormat,
          repositoryId,
          requestId,
          sequence: 7,
        }),
      ),
    ).toMatchObject({ commits: page.commits, sequence: 7 });
  });

  it("preserves Unicode and control characters and keeps byte limits", () => {
    const page = historyPage("sha1");
    const withSubject = (subject: string) => ({
      ...page,
      commits: page.commits.map((commit) => ({ ...commit, subject })),
    });
    const expanded = withSubject("Graph 🦀 漢字\u0000".repeat(2_000));
    expect(
      decodeRepositoryHistoryPage(encodeRepositoryHistoryPage(expanded)),
    ).toEqual(expanded);
    expect(() =>
      encodeRepositoryHistoryPage(withSubject("漢".repeat(400_000))),
    ).toThrow("String is too large");
  });

  it.each(["sha1", "sha256"] as const)(
    "round trips %s commit metadata",
    (objectFormat) => {
      const page = historyPage(objectFormat);

      expect(
        decodeRepositoryHistoryPage(encodeRepositoryHistoryPage(page)),
      ).toEqual(page);
    },
  );

  it("round trips acknowledged synchronization batches", () => {
    const page = historyPage("sha1");
    const batch = {
      commits: page.commits,
      objectFormat: page.objectFormat,
      repositoryId,
      requestId,
      sequence: 7,
    } as const;
    const encoded = encodeRepositoryHistoryBatch(batch);

    expect(readRepositoryHistoryBatchSequence(encoded)).toBe(7);
    expect(decodeRepositoryHistoryBatch(encoded)).toEqual(batch);
  });

  it("rejects batch sequences outside the unsigned wire range", () => {
    const page = historyPage("sha1");
    const batch = {
      commits: [],
      objectFormat: page.objectFormat,
      repositoryId,
      requestId,
      sequence: maximumRepositoryHistorySequence,
    } as const;

    expect(
      decodeRepositoryHistoryBatch(encodeRepositoryHistoryBatch(batch))
        .sequence,
    ).toBe(maximumRepositoryHistorySequence);
    expect(() =>
      encodeRepositoryHistoryBatch({
        ...batch,
        sequence: maximumRepositoryHistorySequence + 1,
      }),
    ).toThrow();
  });

  it("round trips a resumable snapshot basis before publishing refs", () => {
    const page = historyPage("sha1");
    const batch = {
      commits: [],
      objectFormat: page.objectFormat,
      repositoryId,
      requestId,
      sequence: 0,
      snapshot: {
        id: "d".repeat(64),
        objectFormat: page.objectFormat,
        refTargets: page.refTargets,
        resumable: true,
        rootOids: [page.commits[0]?.oid ?? ""],
        shallowOids: ["b".repeat(40)],
      },
    } as const;

    expect(
      decodeRepositoryHistoryBatch(encodeRepositoryHistoryBatch(batch)),
    ).toEqual(batch);
  });

  it("fragments and reassembles a logical history message out of order", () => {
    const page = historyPage("sha1");
    const payload = encodeRepositoryHistoryPage({
      ...page,
      commits: page.commits.map((commit) => ({
        ...commit,
        subject: 'Graph 🦀 漢字\u0000 "quoted" \\'.repeat(100),
      })),
    });
    const frames = fragmentJsonMessage(
      { logicalMessageId: 7, payload, requestId },
      256,
    );
    const reassembler = createJsonMessageReassembler();

    expect(frames.length).toBeGreaterThan(2);
    for (const frame of frames) {
      const json = JSON.stringify(frame);
      expect(new TextEncoder().encode(json).byteLength).toBeLessThanOrEqual(
        256,
      );
      expect(
        Schema.decodeUnknownSync(JsonMessageFragment)(JSON.parse(json)),
      ).toEqual(frame);
    }
    const completed = frames
      .toReversed()
      .map((frame) => reassembler.accept(frame))
      .find((result) => result !== undefined);

    expect(completed).toEqual({ logicalMessageId: 7, payload, requestId });
  });

  it("rejects duplicate fragments and malformed payloads", () => {
    const [first] = fragmentJsonMessage(
      {
        logicalMessageId: 4,
        payload: new Uint8Array(160),
        requestId,
      },
      256,
    );
    const reassembler = createJsonMessageReassembler();

    expect(first).toBeDefined();
    reassembler.accept(requireFragment(first));
    expect(() => reassembler.accept(requireFragment(first))).toThrow();
    expect(() =>
      decodeRepositoryHistoryPage(new Uint8Array([1, 2, 3])),
    ).toThrow();
  });

  it("discards partial messages and rejects invalid request IDs", () => {
    const [first] = fragmentJsonMessage(
      { logicalMessageId: 4, payload: new Uint8Array(160), requestId },
      256,
    );
    const reassembler = createJsonMessageReassembler();
    expect(first).toBeDefined();
    reassembler.accept(requireFragment(first));
    reassembler.discard(requestId);
    expect(() => reassembler.accept(requireFragment(first))).not.toThrow();

    expect(() =>
      Schema.decodeUnknownSync(JsonMessageFragment)({
        ...first,
        requestId: "x".repeat(36),
      }),
    ).toThrow();
  });

  it("rejects pages beyond the encoded collection limits", () => {
    const page = historyPage("sha1");
    const commit = page.commits[0];
    const refTarget = page.refTargets[0];
    if (commit === undefined || refTarget === undefined) {
      throw new Error("The fixture is incomplete");
    }
    expect(() =>
      encodeRepositoryHistoryPage({
        ...page,
        commits: Array.from({ length: 1_001 }, () => commit),
      }),
    ).toThrow();
    expect(() =>
      encodeRepositoryHistoryPage({
        ...page,
        refTargets: Array.from({ length: 257 }, () => refTarget),
      }),
    ).toThrow();
    expect(() =>
      encodeRepositoryHistoryPage({
        ...page,
        commits: [
          {
            ...commit,
            parents: Array.from({ length: 4_097 }, () => commit.oid),
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects logical messages beyond the reassembly limit", () => {
    expect(() =>
      fragmentJsonMessage(
        {
          logicalMessageId: 1,
          payload: new Uint8Array(64 * 1_048_576 + 1),
          requestId,
        },
        1_048_576,
      ),
    ).toThrow("Logical message is too large");
  });
});

function requireFragment(fragment: JsonMessageFragment | undefined) {
  if (fragment === undefined) throw new Error("Missing fragment");
  return fragment;
}

function historyPage(objectFormat: "sha1" | "sha256"): RepositoryHistoryPage {
  const oidLength = objectFormat === "sha1" ? 40 : 64;
  return {
    commits: [
      {
        author: {
          email: "alex@example.test",
          name: "Alex I.",
          timestampSeconds: 1_777_777_777,
          timezoneOffsetMinutes: 120,
        },
        committer: {
          email: "mira@example.test",
          name: "Mira I.",
          timestampSeconds: 1_777_777_778,
          timezoneOffsetMinutes: -330,
        },
        oid: "a".repeat(oidLength),
        parents: ["b".repeat(oidLength), "c".repeat(oidLength)],
        subject: "Keep topology bounded \u0000 without confusing framing",
      },
    ],
    objectFormat,
    refTargets: [
      {
        name: "main",
        oid: "a".repeat(oidLength),
        type: "branch",
      },
    ],
    repositoryId,
    requestId,
  };
}
