import { describe, expect, it } from "vite-plus/test";
import {
  createGitHistoryBatchParser,
  gitHistoryFormat,
  parseGitHistory,
} from "#server/features/repository-history/git/parse-git-history";

describe("Git history metadata", () => {
  it("streams fragmented records into bounded batches", async () => {
    const output = Array.from({ length: 5 }, (_, index) =>
      record({ oid: index.toString(16).padStart(40, "0") }),
    ).join("");
    const batches: unknown[] = [];
    const parser = createGitHistoryBatchParser("sha1", 2, async (batch) => {
      batches.push(batch);
    });

    for (let offset = 0; offset < output.length; offset += 13) {
      await parser.accept(output.slice(offset, offset + 13));
    }

    await expect(parser.finish()).resolves.toBe(5);
    expect(batches).toHaveLength(3);
    expect(batches.map((batch) => (batch as unknown[]).length)).toEqual([
      2, 2, 1,
    ]);
  });

  it("flushes a batch before oversized commit metadata can accumulate", async () => {
    const batches: unknown[][] = [];
    const parser = createGitHistoryBatchParser(
      "sha1",
      100,
      async (batch) => {
        batches.push([...batch]);
      },
      100,
    );
    await parser.accept(
      record({ oid: "a".repeat(40), subject: "a".repeat(200) }) +
        record({ oid: "b".repeat(40), subject: "b".repeat(200) }),
    );
    await parser.finish();

    expect(batches.map((batch) => batch.length)).toEqual([1, 1]);
  });
  it("parses NUL-framed commits, parents, identities, and timezones", () => {
    const first = "a".repeat(40);
    const second = "b".repeat(40);
    const third = "c".repeat(40);
    const output = [
      first,
      `${second} ${third}`,
      "Alex I.",
      "alex@example.test",
      "1777777777",
      "2026-05-03T01:29:37+02:00",
      "Mira I.",
      "mira@example.test",
      "1777777780",
      "2026-05-02T18:59:40-04:30",
      "Merge nested history",
      second,
      "",
      "Mira I.",
      "mira@example.test",
      "1777777700",
      "2026-05-03T01:28:20+02:00",
      "Mira I.",
      "mira@example.test",
      "1777777700",
      "2026-05-03T01:28:20+02:00",
      "Parent",
      "",
    ].join("\0");

    expect(parseGitHistory(output, "sha1")).toEqual([
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
          timestampSeconds: 1_777_777_780,
          timezoneOffsetMinutes: -270,
        },
        oid: first,
        parents: [second, third],
        subject: "Merge nested history",
      },
      {
        author: {
          email: "mira@example.test",
          name: "Mira I.",
          timestampSeconds: 1_777_777_700,
          timezoneOffsetMinutes: 120,
        },
        committer: {
          email: "mira@example.test",
          name: "Mira I.",
          timestampSeconds: 1_777_777_700,
          timezoneOffsetMinutes: 120,
        },
        oid: second,
        parents: [],
        subject: "Parent",
      },
    ]);
    expect(gitHistoryFormat.split("%x00")).toHaveLength(11);
  });

  it("rejects truncated records, invalid object IDs, and invalid timestamps", () => {
    expect(() => parseGitHistory("a\0b\0", "sha1")).toThrow();
    expect(() =>
      parseGitHistory(record({ oid: "not-an-oid" }), "sha1"),
    ).toThrow();
    expect(() =>
      parseGitHistory(record({ authorTimestamp: "yesterday" }), "sha1"),
    ).toThrow();
  });

  it("parses UTC dates emitted with the Z designator", () => {
    expect(
      parseGitHistory(
        record({
          authorIsoDate: "2026-08-27T11:15:25Z",
          committerIsoDate: "2026-08-27T11:15:25Z",
        }),
        "sha1",
      ),
    ).toEqual([
      expect.objectContaining({
        author: expect.objectContaining({ timezoneOffsetMinutes: 0 }),
        committer: expect.objectContaining({ timezoneOffsetMinutes: 0 }),
      }),
    ]);
  });
});

function record({
  authorIsoDate = "2026-05-03T01:29:37+02:00",
  authorTimestamp = "1777777777",
  committerIsoDate = "2026-05-03T01:29:37+02:00",
  oid = "a".repeat(40),
  subject = "Subject",
}: {
  readonly authorIsoDate?: string;
  readonly authorTimestamp?: string;
  readonly committerIsoDate?: string;
  readonly oid?: string;
  readonly subject?: string;
}) {
  return [
    oid,
    "",
    "Alex I.",
    "alex@example.test",
    authorTimestamp,
    authorIsoDate,
    "Alex I.",
    "alex@example.test",
    "1777777777",
    committerIsoDate,
    subject,
    "",
  ].join("\0");
}
