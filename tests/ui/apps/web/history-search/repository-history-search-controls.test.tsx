import { act, StrictMode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import type { RepositoryCommit } from "#contracts/repository-history/repository-history.contract.ts";
import { render } from "#tests-support/render.tsx";
import { RepositoryHistorySearchControls } from "#web/features/history-search/components/repository-history-search-controls.tsx";
import type {
  HistorySearchPage,
  HistorySnapshot,
} from "#web/features/repository-history/history-worker-protocol.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import { createStore } from "#web/platform/store/store.ts";

type Search = (
  query: {
    readonly text: string;
    readonly limit: number;
    readonly cursor?: string;
  },
  signal?: AbortSignal,
) => Promise<HistorySearchPage>;

const snapshot: HistorySnapshot = {
  revision: 1,
  status: "ready",
  synchronization: "complete",
  commitCount: 100,
  refTargets: [],
};
describe("history search controls", () => {
  it("loads further matches by scrolling without opening a commit", async () => {
    const reader = searchable(
      vi
        .fn<Search>()
        .mockResolvedValueOnce({
          ...result(Array.from({ length: 20 }, (_, index) => commit(index))),
          cursor: "more",
        })
        .mockResolvedValueOnce(result([commit(20), commit(21)])),
    );
    const onNavigate = vi.fn(async () => {});
    await render(
      <RepositoryHistorySearchControls
        history={reader}
        snapshot={snapshot}
        onNavigate={onNavigate}
      />,
    );
    const input = page.getByRole("searchbox");
    await input.click();
    await expect.element(input).toHaveAttribute("aria-expanded", "false");
    await input.fill("history");
    const matches = page.getByRole("region", { name: "Search matches" });
    await expect.element(matches).toBeVisible();
    const element = matches.element();
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
    await expect.poll(() => reader.search).toHaveBeenCalledTimes(2);
    expect(onNavigate).not.toHaveBeenCalled();
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
    await page
      .getByRole("button", { name: /Repair shallow history 21/ })
      .click();
    await expect
      .poll(() => onNavigate)
      .toHaveBeenCalledWith(commit(21).oid, expect.any(AbortSignal));
  });

  it("keeps opening a result while history changes and refreshes afterwards", async () => {
    const reader = searchable(
      vi.fn<Search>().mockResolvedValue(result([commit(1)])),
    );
    const signals: AbortSignal[] = [];
    let finish = () => {};
    const onNavigate = vi.fn((_oid: string, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const screen = await render(
      <RepositoryHistorySearchControls
        history={reader}
        snapshot={snapshot}
        onNavigate={onNavigate}
      />,
    );
    await page.getByRole("searchbox").fill("history");
    await page
      .getByRole("button", { name: /Repair shallow history 1/ })
      .click();
    await expect.poll(() => onNavigate).toHaveBeenCalledOnce();

    await screen.rerender(
      <RepositoryHistorySearchControls
        history={reader}
        snapshot={{ ...snapshot, revision: 2 }}
        onNavigate={onNavigate}
      />,
    );

    expect(signals.map((signal) => signal.aborted)).toEqual([false]);
    expect(reader.search).toHaveBeenCalledOnce();
    await act(async () => finish());
    await expect.poll(() => reader.search).toHaveBeenCalledTimes(2);
  });

  it("keeps one request in Strict Mode and transfers the query on repository switching", async () => {
    const signals: AbortSignal[] = [];
    const search = vi.fn<Search>((_query, signal) => {
      if (signal !== undefined) signals.push(signal);
      return new Promise(() => {});
    });
    const first = searchable(search);
    const second = searchable(search);
    const onNavigate = vi.fn(async () => {});
    const screen = await render(
      <StrictMode>
        <RepositoryHistorySearchControls
          history={first}
          snapshot={snapshot}
          onNavigate={onNavigate}
        />
      </StrictMode>,
    );
    await page.getByRole("searchbox").fill("history");
    await expect.poll(() => search).toHaveBeenCalledTimes(1);
    await screen.rerender(
      <StrictMode>
        <RepositoryHistorySearchControls
          history={second}
          snapshot={snapshot}
          onNavigate={onNavigate}
        />
      </StrictMode>,
    );
    await expect.poll(() => search).toHaveBeenCalledTimes(2);
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    await expect.element(page.getByRole("searchbox")).toHaveValue("history");
    await screen.unmount();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("continues sparse pages and shows cached metadata and partial offline coverage", async () => {
    const reader = searchable(
      vi
        .fn<Search>()
        .mockResolvedValueOnce({ ...result([]), cursor: "continue" })
        .mockResolvedValueOnce({
          ...result([commit(1)]),
          complete: false,
          commitCount: 42,
        }),
    );
    await render(
      <RepositoryHistorySearchControls
        history={reader}
        snapshot={snapshot}
        onNavigate={vi.fn()}
        offline
      />,
    );
    await page
      .getByRole("searchbox", { name: "Search history" })
      .fill("shallow");
    await expect
      .element(page.getByRole("button", { name: /Repair shallow history 1/ }))
      .toBeVisible();
    expect(reader.search).toHaveBeenNthCalledWith(
      2,
      { text: "shallow", cursor: "continue", limit: 20 },
      expect.any(AbortSignal),
    );
    await expect
      .element(page.getByText("Alex · alex@example.test"))
      .toBeVisible();
    await expect
      .element(page.getByText("Offline · Partial results"))
      .toBeVisible();
    await expect
      .element(page.getByRole("searchbox"))
      .toHaveAttribute("maxlength", "256");
  });

  it("uses the same navigation handlers for result clicks, Enter, Shift Enter", async () => {
    const reader = searchable(
      vi
        .fn<Search>()
        .mockResolvedValueOnce({
          ...result([commit(1), commit(2)]),
          cursor: "next",
        })
        .mockResolvedValue(result([commit(3)])),
    );
    const onNavigate = vi.fn(async () => undefined);
    await render(
      <RepositoryHistorySearchControls
        history={reader}
        snapshot={snapshot}
        onNavigate={onNavigate}
      />,
    );
    const input = page.getByRole("searchbox");
    await input.fill("history");
    await expect
      .element(page.getByRole("button", { name: /Repair shallow history 1/ }))
      .toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => onNavigate)
      .toHaveBeenLastCalledWith(commit(1).oid, expect.any(AbortSignal));
    await page
      .getByRole("button", { name: /Repair shallow history 2/ })
      .click();
    await expect
      .poll(() => onNavigate)
      .toHaveBeenLastCalledWith(commit(2).oid, expect.any(AbortSignal));
    await input.click();
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await expect
      .poll(() => onNavigate)
      .toHaveBeenLastCalledWith(commit(1).oid, expect.any(AbortSignal));
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => onNavigate)
      .toHaveBeenLastCalledWith(commit(2).oid, expect.any(AbortSignal));
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => onNavigate)
      .toHaveBeenLastCalledWith(commit(3).oid, expect.any(AbortSignal));
    expect(reader.search).toHaveBeenLastCalledWith(
      { text: "history", cursor: "next", limit: 20 },
      expect.any(AbortSignal),
    );
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await userEvent.keyboard("{Escape}");
    await expect
      .element(page.getByRole("dialog", { name: "History search results" }))
      .not.toBeInTheDocument();
    await expect.element(input).toHaveFocus();
    await input.click();
    await expect
      .element(page.getByRole("dialog", { name: "History search results" }))
      .toBeVisible();
  });

  it("cancels pending text and content revisions without showing stale results", async () => {
    let finish: ((value: HistorySearchPage) => void) | undefined;
    const reader = searchable(
      vi
        .fn<Search>()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        )
        .mockResolvedValue(result([commit(2)])),
    );
    const onNavigate = vi.fn(async () => undefined);
    const screen = await render(
      <RepositoryHistorySearchControls
        history={reader}
        snapshot={snapshot}
        onNavigate={onNavigate}
      />,
    );
    await page.getByRole("searchbox").fill("old");
    await expect.poll(() => reader.search).toHaveBeenCalledTimes(1);
    const signal = reader.search.mock.calls[0]?.[1];
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Searching");
    await page.getByRole("searchbox").fill("new");
    await expect
      .element(page.getByRole("button", { name: /Repair shallow history 2/ }))
      .toBeVisible();
    expect(signal?.aborted).toBe(true);
    await act(async () => finish?.(result([commit(1)])));
    await expect
      .element(page.getByRole("button", { name: /Repair shallow history 2/ }))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: /Repair shallow history 1/ }))
      .not.toBeInTheDocument();
    expect(reader.search).toHaveBeenCalledTimes(2);
    await screen.rerender(
      <RepositoryHistorySearchControls
        history={reader}
        snapshot={{ ...snapshot, revision: 2 }}
        onNavigate={onNavigate}
      />,
    );
    await expect.poll(() => reader.search).toHaveBeenCalledTimes(3);
  });

  it("preserves the selected OID across content updates without navigating again", async () => {
    const reader = searchable(
      vi.fn<Search>().mockResolvedValue(result([commit(1), commit(2)])),
    );
    const onNavigate = vi.fn(async () => undefined);
    const screen = await render(
      <RepositoryHistorySearchControls
        history={reader}
        snapshot={snapshot}
        onNavigate={onNavigate}
      />,
    );
    await page.getByRole("searchbox").fill("history");
    await page
      .getByRole("button", { name: /Repair shallow history 2/ })
      .click();
    reader.search.mockResolvedValue(result([commit(3), commit(1), commit(2)]));
    await screen.rerender(
      <RepositoryHistorySearchControls
        history={reader}
        snapshot={{ ...snapshot, revision: 2 }}
        onNavigate={onNavigate}
      />,
    );
    await expect
      .element(page.getByRole("button", { name: /Repair shallow history 2/ }))
      .toHaveAttribute("aria-current", "true");
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it.each([
    { selectedPage: 4, emptyPages: false },
    { selectedPage: 5, emptyPages: false },
    { selectedPage: 5, emptyPages: true },
  ])(
    "bounds selection restoration at five requests: %j",
    async ({ selectedPage, emptyPages }) => {
      const reader = searchable(
        vi.fn<Search>().mockResolvedValue(result([commit(99)])),
      );
      const onNavigate = vi.fn(async () => undefined);
      const screen = await render(
        <RepositoryHistorySearchControls
          history={reader}
          snapshot={snapshot}
          onNavigate={onNavigate}
        />,
      );
      await page.getByRole("searchbox").fill("history");
      await page
        .getByRole("button", { name: /Repair shallow history 99/ })
        .click();
      reader.search.mockClear();
      reader.search.mockImplementation(async (query) => {
        const index = Number(query.cursor ?? 0);
        return {
          ...result(
            index === selectedPage
              ? [commit(99)]
              : emptyPages
                ? []
                : [commit(index)],
          ),
          ...(index < selectedPage ? { cursor: String(index + 1) } : {}),
        };
      });
      await screen.rerender(
        <RepositoryHistorySearchControls
          history={reader}
          snapshot={{ ...snapshot, revision: 2 }}
          onNavigate={onNavigate}
        />,
      );
      await expect.poll(() => reader.search).toHaveBeenCalledTimes(5);
      if (selectedPage === 4) {
        await expect
          .element(
            page.getByRole("button", { name: /Repair shallow history 99/ }),
          )
          .toHaveAttribute("aria-current", "true");
      } else {
        await expect
          .element(
            page.getByRole("button", { name: /Repair shallow history 99/ }),
          )
          .not.toBeInTheDocument();
      }
      expect(reader.search).toHaveBeenCalledTimes(5);
      expect(onNavigate).toHaveBeenCalledTimes(1);
      if (emptyPages) {
        await expect
          .element(page.getByText("No matches."))
          .not.toBeInTheDocument();
      }
    },
  );

  it("keeps pending navigation disabled and reports failures with a retry", async () => {
    let rejectNavigation: ((error: Error) => void) | undefined;
    const reader = searchable(
      vi
        .fn<Search>()
        .mockRejectedValueOnce(new Error("Unavailable"))
        .mockResolvedValue(result([commit(1)])),
    );
    const onNavigate = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectNavigation = reject;
        }),
    );
    await render(
      <RepositoryHistorySearchControls
        history={reader}
        snapshot={snapshot}
        onNavigate={onNavigate}
      />,
    );
    await page.getByRole("searchbox").fill("history");
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Could not search cached history.");
    await page.getByRole("button", { name: "Retry" }).click();
    await page
      .getByRole("button", { name: /Repair shallow history 1/ })
      .click();
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Opening result");
    await expect
      .element(page.getByRole("button", { name: /Repair shallow history 1/ }))
      .toBeDisabled();
    rejectNavigation?.(new Error("Not found"));
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Could not open this search result.");
    await page.getByRole("button", { name: "Clear history search" }).click();
    await expect.element(page.getByRole("searchbox")).toHaveValue("");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  });
});

function result(commits: readonly RepositoryCommit[]): HistorySearchPage {
  return { commits, complete: true, commitCount: 100 };
}

function searchable<Searching extends Search>(search: Searching) {
  return {
    ...createStore(snapshot),
    search,
    ask: (query, signal) =>
      query._tag === "Search"
        ? search(
            {
              text: query.text,
              limit: query.limit,
              ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            },
            signal,
          )
        : Promise.reject(new Error("Unexpected history query")),
    synchronize: () => {},
    close: () => {},
  } as RepositoryHistory & { readonly search: Searching };
}

function commit(index: number): RepositoryCommit {
  const identity = {
    name: "Alex",
    email: "alex@example.test",
    timestampSeconds: 1_777_777_777 - index,
    timezoneOffsetMinutes: 0,
  };
  return {
    oid: index.toString(16).padStart(40, "0"),
    parents: [],
    author: identity,
    committer: identity,
    subject: `Repair shallow history ${index}`,
  };
}
