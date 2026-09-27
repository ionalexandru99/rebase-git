import {
  decodeRepositoryHistoryBatch,
  decodeRepositoryHistoryPage,
  encodeRepositoryHistoryBatch,
  encodeRepositoryHistoryPage,
  maximumRepositoryHistorySequence,
  type RepositoryHistoryPage,
} from "@rebase/contracts";
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
    expect(() =>
      decodeRepositoryHistoryBatch(
        new TextEncoder().encode(
          JSON.stringify({
            ...batch,
            sequence: maximumRepositoryHistorySequence + 1,
          }),
        ),
      ),
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
});

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
