import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { GraphCommandContext } from "#web/features/commit-commands/graph-command.contract";
import { createGraphCommandRegistry } from "#web/features/commit-commands/graph-command-registry";
import { CommitRefLabels } from "#web-ui/features/commit-graph/components/commit-ref-labels";

describe("commit ref menu focus", () => {
  it.each([{ remaining: ["next"] }, { remaining: [] }])(
    "restores focus when the open ref disappears and remaining labels are $remaining",
    async ({ remaining }) => {
      const focusTarget = createRef<HTMLButtonElement>();
      const registry = createGraphCommandRegistry({
        readCommit: async () => undefined,
        writeClipboard: async () => {},
        toggleHistoryRef: () => {},
      });
      const view = (names: readonly string[]) => (
        <>
          <button ref={focusTarget} type="button">
            Commit history
          </button>
          <CommitRefLabels
            labels={names.map((name) => ({
              name,
              oid: "0".repeat(40),
              type: "branch",
            }))}
            context={(label): GraphCommandContext => ({
              environmentId: "environment",
              logicalRepositoryId: "logical",
              repositoryId: "registered",
              connected: true,
              freshnessReady: true,
              operationState: "idle",
              capabilities: new Set(),
              selectedOids: [],
              ref: {
                target: { _tag: "LocalBranch", name: label.name },
                included: true,
              },
            })}
            registry={registry}
            execute={async () => {}}
            restoreFocus={() => focusTarget.current?.focus()}
          />
        </>
      );
      const screen = await render(view(["main"]));
      screen
        .getByRole("button", { name: "Actions for main" })
        .element()
        .focus();
      await userEvent.keyboard("{ArrowDown}");
      await expect
        .element(screen.getByRole("menuitem", { name: "Remove from history" }))
        .toHaveFocus();
      await screen.rerender(view(remaining));
      await expect.element(screen.getByRole("menu")).not.toBeInTheDocument();
      await expect
        .element(screen.getByRole("button", { name: "Commit history" }))
        .toHaveFocus();
    },
  );
});

import { createRef } from "react";
