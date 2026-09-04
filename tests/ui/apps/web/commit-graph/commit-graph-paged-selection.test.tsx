import type { RepositoryCommit } from "@rebase/contracts";
import { useMemo } from "react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useCommitGraphSelection } from "#web/features/commit-graph/use-commit-graph-selection";
import type {
  RepositoryHistoryQuery,
  RepositoryHistoryReader,
} from "#web/features/repository-history/repository-history-reader.contract";

const query: RepositoryHistoryQuery = {
  limit: 100,
  order: "topological",
  roots: [],
};
const identity = {
  name: "Alex",
  email: "alex@example.test",
  timestampSeconds: 0,
  timezoneOffsetMinutes: 0,
};
const commits: readonly RepositoryCommit[] = Array.from(
  { length: 2_002 },
  (_, index) => ({
    oid: `row-${index}`,
    subject: `${index}`,
    parents: [],
    author: identity,
    committer: identity,
  }),
);

function createReader() {
  let history = commits;
  return {
    locateMany: vi.fn<RepositoryHistoryReader["locateMany"]>(
      async (_query, oids) =>
        history.flatMap((commit, index) =>
          oids.includes(commit.oid) ? [{ oid: commit.oid, index }] : [],
        ),
    ),
    read: vi.fn<RepositoryHistoryReader["read"]>(
      async ({ offset = 0, limit }) => history.slice(offset, offset + limit),
    ),
    replaceHistory: (next: readonly RepositoryCommit[]) => {
      history = next;
    },
  };
}

function Selection({
  reader,
  offset,
  epoch = 0,
}: {
  readonly reader: ReturnType<typeof createReader>;
  readonly offset: number;
  readonly epoch?: number;
}) {
  const oids = useMemo(
    () => commits.slice(offset, offset + 2).map((commit) => commit.oid),
    [offset],
  );
  const selection = useCommitGraphSelection({
    reader,
    query,
    oids,
    laneRows: [],
    merges: new Map(),
    pageSize: 2,
    scrollToIndex: () => {},
    toggleMerge: () => {},
    startOffset: offset,
    viewEpoch: epoch,
  });
  return (
    <>
      {oids.map((oid) => (
        <button
          key={oid}
          onClick={(event) => selection.onClick(oid, event)}
          type="button"
        >
          {oid}
        </button>
      ))}
      <output aria-label="Selection">
        {JSON.stringify(selection.selection.selectedOids)}
      </output>
      <output aria-label="Anchor">{selection.selection.anchorOid}</output>
      <output aria-label="Active">{selection.selection.activeOid}</output>
    </>
  );
}

async function modifiedClick(name: string, modifier: "Control" | "Shift") {
  await userEvent.keyboard(`{${modifier}>}`);
  await page.getByRole("button", { name, exact: true }).click();
  await userEvent.keyboard(`{/${modifier}}`);
}

describe("selection across evicted graph pages", () => {
  it("retains and orders toggled OIDs outside the resident window, then reconciles full-query membership", async () => {
    const reader = createReader();
    const screen = await render(<Selection reader={reader} offset={0} />);
    await page.getByRole("button", { name: "row-0", exact: true }).click();
    await screen.rerender(<Selection reader={reader} offset={2_000} />);
    await modifiedClick("row-2001", "Control");
    await expect
      .element(page.getByLabelText("Selection"))
      .toHaveTextContent('["row-0","row-2001"]');
    await screen.rerender(
      <Selection reader={reader} offset={1_000} epoch={1} />,
    );
    await expect
      .element(page.getByLabelText("Selection"))
      .toHaveTextContent('["row-0","row-2001"]');
    reader.replaceHistory(commits.slice(1));
    await screen.rerender(
      <Selection reader={reader} offset={1_000} epoch={2} />,
    );
    await expect
      .element(page.getByLabelText("Selection"))
      .toHaveTextContent('["row-2001"]');
    expect(
      reader.locateMany.mock.calls.every(([, oids]) => oids.length <= 1_000),
    ).toBe(true);
  });

  it("extends an evicted anchor using bounded range reads and preserves it when shrinking backwards", async () => {
    const reader = createReader();
    const screen = await render(<Selection reader={reader} offset={0} />);
    await page.getByRole("button", { name: "row-0", exact: true }).click();
    await screen.rerender(<Selection reader={reader} offset={2_000} />);
    await modifiedClick("row-2001", "Shift");
    await expect
      .element(page.getByLabelText("Selection"))
      .toHaveTextContent(JSON.stringify(commits.map((commit) => commit.oid)));
    await expect
      .element(page.getByLabelText("Anchor"))
      .toHaveTextContent("row-0");
    expect(reader.read.mock.calls.map(([request]) => request.limit)).toEqual([
      1_000, 1_000, 2,
    ]);
    await screen.rerender(<Selection reader={reader} offset={1_000} />);
    await modifiedClick("row-1000", "Shift");
    await expect
      .element(page.getByLabelText("Selection"))
      .toHaveTextContent(
        JSON.stringify(commits.slice(0, 1_001).map((commit) => commit.oid)),
      );
    await expect
      .element(page.getByLabelText("Anchor"))
      .toHaveTextContent("row-0");
  });

  it("keeps the latest click when an earlier range read finishes late", async () => {
    const reader = createReader();
    const screen = await render(<Selection reader={reader} offset={0} />);
    await page.getByRole("button", { name: "row-0", exact: true }).click();
    await screen.rerender(<Selection reader={reader} offset={2_000} />);
    let finish: ((value: readonly RepositoryCommit[]) => void) | undefined;
    reader.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await modifiedClick("row-2001", "Shift");
    await expect.poll(() => reader.read.mock.calls.length).toBe(1);
    await modifiedClick("row-2000", "Shift");
    await expect
      .element(page.getByLabelText("Selection"))
      .toHaveTextContent(
        JSON.stringify(commits.slice(0, 2_001).map((commit) => commit.oid)),
      );
    await page.getByRole("button", { name: "row-2000", exact: true }).click();
    finish?.(commits.slice(0, 1_000));
    await expect
      .element(page.getByLabelText("Selection"))
      .toHaveTextContent('["row-2000"]');
    await expect
      .element(page.getByLabelText("Active"))
      .toHaveTextContent("row-2000");
    expect(reader.read).toHaveBeenCalledTimes(4);
  });
});
