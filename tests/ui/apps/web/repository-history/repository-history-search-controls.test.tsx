import type { RepositoryCommit } from "@rebase/contracts";
import { act, createRef, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { RepositoryHistorySearchActions } from "#web/features/repository-history/search/components/repository-history-search-controls.contract";
import type {
  RepositoryHistorySearch,
  RepositoryHistorySearchResult,
} from "#web/features/repository-history/search/repository-history-search.contract";
import { RepositoryHistorySearchControls } from "#web-ui/features/repository-history/search/components/repository-history-search-controls";

const snapshot = {
  historyRevision: 1,
  revision: 1,
  status: "ready" as const,
  synchronization: "complete" as const,
  synchronizedCommitCount: 100,
};
const bindings = {
  open: { shortcut: "Ctrl F", ariaKeyShortcuts: "Control+F" },
  next: { shortcut: "F3", ariaKeyShortcuts: "F3" },
  previous: { shortcut: "Shift F3", ariaKeyShortcuts: "Shift+F3" },
};

describe("history search controls", () => {
  it("keeps one request in Strict Mode and transfers the query on repository switching", async () => {
    const signals: AbortSignal[] = [];
    const search = vi.fn<RepositoryHistorySearch["search"]>(
      (_query, signal) => {
        if (signal !== undefined) signals.push(signal);
        return new Promise(() => {});
      },
    );
    const first = { search };
    const second = { search };
    const onNavigate = vi.fn(async () => {});
    const screen = await render(
      <StrictMode>
        <RepositoryHistorySearchControls
          reader={first}
          snapshot={snapshot}
          onNavigate={onNavigate}
        />
      </StrictMode>,
    );
    await page.getByRole("searchbox").fill("history");
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await screen.rerender(
      <StrictMode>
        <RepositoryHistorySearchControls
          reader={second}
          snapshot={snapshot}
          onNavigate={onNavigate}
        />
      </StrictMode>,
    );
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    await expect.element(page.getByRole("searchbox")).toHaveValue("history");
    await screen.unmount();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("continues sparse pages and shows cached metadata and partial offline coverage", async () => {
    const reader = {
      search: vi
        .fn<RepositoryHistorySearch["search"]>()
        .mockResolvedValueOnce({ ...result([]), nextCursor: "continue" })
        .mockResolvedValueOnce({
          ...result([commit(1)]),
          replicaComplete: false,
          synchronizedCommitCount: 42,
        }),
    };
    await render(
      <RepositoryHistorySearchControls
        reader={reader}
        snapshot={snapshot}
        onNavigate={vi.fn()}
        bindings={bindings}
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
    await expect
      .element(page.getByRole("searchbox"))
      .toHaveAttribute("aria-keyshortcuts", "Control+F");
  });

  it("uses the same navigation handlers for buttons, Enter, Shift Enter and external shortcuts", async () => {
    const actions = createRef<RepositoryHistorySearchActions>();
    const reader = {
      search: vi
        .fn<RepositoryHistorySearch["search"]>()
        .mockResolvedValueOnce({
          ...result([commit(1), commit(2)]),
          nextCursor: "next",
        })
        .mockResolvedValue(result([commit(3)])),
    };
    const onNavigate = vi.fn(async () => undefined);
    await render(
      <RepositoryHistorySearchControls
        ref={actions}
        reader={reader}
        snapshot={snapshot}
        onNavigate={onNavigate}
        bindings={bindings}
      />,
    );
    const input = page.getByRole("searchbox");
    await input.fill("history");
    await expect
      .element(page.getByRole("button", { name: /Repair shallow history 1/ }))
      .toBeVisible();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() =>
      expect(onNavigate).toHaveBeenLastCalledWith(
        commit(1).oid,
        expect.any(AbortSignal),
      ),
    );
    await page.getByRole("button", { name: "Next search result" }).click();
    await vi.waitFor(() =>
      expect(onNavigate).toHaveBeenLastCalledWith(
        commit(2).oid,
        expect.any(AbortSignal),
      ),
    );
    await input.click();
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await vi.waitFor(() =>
      expect(onNavigate).toHaveBeenLastCalledWith(
        commit(1).oid,
        expect.any(AbortSignal),
      ),
    );
    actions.current?.next();
    await vi.waitFor(() =>
      expect(onNavigate).toHaveBeenLastCalledWith(
        commit(2).oid,
        expect.any(AbortSignal),
      ),
    );
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Result 2");
    await expect
      .element(page.getByRole("button", { name: "Next search result" }))
      .toBeEnabled();
    actions.current?.next();
    await vi.waitFor(() =>
      expect(onNavigate).toHaveBeenLastCalledWith(
        commit(3).oid,
        expect.any(AbortSignal),
      ),
    );
    expect(reader.search).toHaveBeenLastCalledWith(
      { text: "history", cursor: "next", limit: 20 },
      expect.any(AbortSignal),
    );
    await expect
      .element(page.getByRole("button", { name: "Previous search result" }))
      .toHaveAttribute("aria-keyshortcuts", "Shift+F3");
    await page.getByRole("button", { name: "Previous search result" }).click();
    await userEvent.keyboard("{Escape}");
    await expect
      .element(page.getByRole("dialog", { name: "History search results" }))
      .not.toBeInTheDocument();
    await expect.element(input).toHaveFocus();
    actions.current?.open();
    await expect
      .element(page.getByRole("dialog", { name: "History search results" }))
      .toBeVisible();
  });

  it("cancels pending text and content revisions without showing stale results", async () => {
    let finish: ((value: RepositoryHistorySearchResult) => void) | undefined;
    const reader = {
      search: vi
        .fn<RepositoryHistorySearch["search"]>()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        )
        .mockResolvedValue(result([commit(2)])),
    };
    const onNavigate = vi.fn(async () => undefined);
    const screen = await render(
      <RepositoryHistorySearchControls
        reader={reader}
        snapshot={snapshot}
        onNavigate={onNavigate}
      />,
    );
    await page.getByRole("searchbox").fill("old");
    await vi.waitFor(() => expect(reader.search).toHaveBeenCalledTimes(1));
    const signal = reader.search.mock.calls[0]?.[1];
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Searching cached history");
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
    await screen.rerender(
      <RepositoryHistorySearchControls
        reader={reader}
        snapshot={{ ...snapshot, revision: 99 }}
        onNavigate={onNavigate}
      />,
    );
    expect(reader.search).toHaveBeenCalledTimes(2);
    await screen.rerender(
      <RepositoryHistorySearchControls
        reader={reader}
        snapshot={{ ...snapshot, historyRevision: 2 }}
        onNavigate={onNavigate}
      />,
    );
    await vi.waitFor(() => expect(reader.search).toHaveBeenCalledTimes(3));
  });

  it("preserves the selected OID across content updates without navigating again", async () => {
    const reader = {
      search: vi
        .fn<RepositoryHistorySearch["search"]>()
        .mockResolvedValue(result([commit(1), commit(2)])),
    };
    const onNavigate = vi.fn(async () => undefined);
    const screen = await render(
      <RepositoryHistorySearchControls
        reader={reader}
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
        reader={reader}
        snapshot={{ ...snapshot, historyRevision: 2 }}
        onNavigate={onNavigate}
      />,
    );
    await expect
      .element(page.getByRole("button", { name: /Repair shallow history 2/ }))
      .toHaveAttribute("aria-current", "true");
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Result 3");
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it.each([
    { selectedPage: 4, emptyPages: false },
    { selectedPage: 5, emptyPages: false },
    { selectedPage: 5, emptyPages: true },
  ])(
    "bounds selection restoration at five requests: %j",
    async ({ selectedPage, emptyPages }) => {
      const reader = {
        search: vi
          .fn<RepositoryHistorySearch["search"]>()
          .mockResolvedValue(result([commit(99)])),
      };
      const onNavigate = vi.fn(async () => undefined);
      const screen = await render(
        <RepositoryHistorySearchControls
          reader={reader}
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
          ...(index < selectedPage ? { nextCursor: String(index + 1) } : {}),
        };
      });
      await screen.rerender(
        <RepositoryHistorySearchControls
          reader={reader}
          snapshot={{ ...snapshot, historyRevision: 2 }}
          onNavigate={onNavigate}
        />,
      );
      await vi.waitFor(() => expect(reader.search).toHaveBeenCalledTimes(5));
      if (selectedPage === 4) {
        await expect
          .element(
            page.getByRole("button", { name: /Repair shallow history 99/ }),
          )
          .toHaveAttribute("aria-current", "true");
      } else {
        await expect
          .element(page.getByRole("button", { name: "Next search result" }))
          .toBeEnabled();
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
          .element(page.getByText("No matches in cached history."))
          .not.toBeInTheDocument();
      }
    },
  );

  it("keeps pending navigation disabled and reports failures with a retry", async () => {
    let rejectNavigation: ((error: Error) => void) | undefined;
    const reader = {
      search: vi
        .fn<RepositoryHistorySearch["search"]>()
        .mockRejectedValueOnce(new Error("Unavailable"))
        .mockResolvedValue(result([commit(1)])),
    };
    const onNavigate = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectNavigation = reject;
        }),
    );
    await render(
      <RepositoryHistorySearchControls
        reader={reader}
        snapshot={snapshot}
        onNavigate={onNavigate}
      />,
    );
    await page.getByRole("searchbox").fill("history");
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Could not search cached history.");
    await page.getByRole("button", { name: "Retry search" }).click();
    await page
      .getByRole("button", { name: /Repair shallow history 1/ })
      .click();
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Opening result");
    await expect
      .element(page.getByRole("button", { name: "Next search result" }))
      .toBeDisabled();
    rejectNavigation?.(new Error("Not found"));
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Could not open this search result.");
    await page.getByRole("button", { name: "Clear history search" }).click();
    await expect.element(page.getByRole("searchbox")).toHaveValue("");
    await expect
      .element(
        page.getByText(
          "Find a commit by hash, subject, author, email, or ref name.",
        ),
      )
      .toBeVisible();
  });
});

function result(
  commits: readonly RepositoryCommit[],
): RepositoryHistorySearchResult {
  return { commits, replicaComplete: true, synchronizedCommitCount: 100 };
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
