import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { browserKeyboardShortcutHost } from "#web/features/keyboard-shortcuts/browser-keyboard-shortcut-host";
import { createKeyboardShortcutStore } from "#web/features/keyboard-shortcuts/keyboard-shortcut-store";
import type { LocalEnvironmentSession } from "#web/features/local-environment-session/local-environment-session.contract";
import { ApplicationShell } from "#web-ui/features/application-shell/application-shell";
import { KeyboardShortcutsProvider } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";
import { RepositoryWorkspace } from "#web-ui/features/repository-workspace/repository-workspace";

describe("application shell", () => {
  it("renders the empty project shell and focuses repository search", async () => {
    await renderShell();

    await expect
      .element(page.getByRole("region", { name: "Rebase application" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("navigation", { name: "Projects" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("heading", { level: 1, name: "Projects" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("status"))
      .toHaveAttribute("data-connection-state", "PairingRequired");
    await expect
      .element(page.getByRole("main", { name: "Open project" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("searchbox", { name: "Search repositories" }))
      .toHaveFocus();
    await expect
      .element(page.getByRole("button", { name: "Browse files" }))
      .toBeDisabled();
  });

  it("opens the project launcher from expanded and collapsed sidebars", async () => {
    await renderShell();

    const repositorySearch = page.getByRole("searchbox", {
      name: "Search repositories",
    });
    const projectFilter = page.getByRole("textbox", {
      name: "Filter open projects",
    });
    await projectFilter.fill("rebase");
    await page.getByRole("button", { name: "Open project" }).click();
    await expect.element(repositorySearch).toHaveFocus();

    await page
      .getByRole("button", { name: "Collapse Projects sidebar" })
      .click();
    await expect
      .element(page.getByRole("heading", { level: 1, name: "Projects" }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Open project" }).click();
    await expect.element(repositorySearch).toHaveFocus();

    await page.getByRole("button", { name: "Expand Projects sidebar" }).click();
    await expect.element(projectFilter).toHaveValue("rebase");
  });

  it("controls project navigation and settings with keyboard shortcuts", async () => {
    await renderShell();

    const projectFilter = page.getByRole("textbox", {
      name: "Filter open projects",
    });
    await projectFilter.fill("rebase");

    await userEvent.keyboard("{Control>}b{/Control}");
    await expect
      .element(page.getByRole("heading", { level: 1, name: "Projects" }))
      .not.toBeInTheDocument();

    await userEvent.keyboard("{Control>}b{/Control}");
    await userEvent.keyboard("{Control>}{Shift>}f{/Shift}{/Control}");
    await expect.element(projectFilter).toHaveFocus();
    await expect.element(projectFilter).toHaveValue("rebase");

    await userEvent.keyboard("{Control>}{Shift>}o{/Shift}{/Control}");
    await expect
      .element(page.getByRole("searchbox", { name: "Search repositories" }))
      .toHaveFocus();

    await userEvent.keyboard("{Control>},{/Control}");
    await expect
      .element(page.getByRole("navigation", { name: "Settings" }))
      .toBeVisible();

    await userEvent.keyboard("{Escape}");
    await expect
      .element(page.getByRole("navigation", { name: "Projects" }))
      .toBeVisible();
  });

  it("resizes the branches sidebar within its configured bounds", async () => {
    await renderRepositoryWorkspace();
    const branches = page.getByRole("navigation", { name: "Branches" });
    const handle = page.getByRole("separator");
    const width = () => branches.element().getBoundingClientRect().width;
    const initialWidth = width();

    await handle.click();
    await expect.element(handle).toHaveFocus();
    await userEvent.keyboard("{ArrowRight>30}");

    const maximumWidth = width();
    expect(maximumWidth).toBeGreaterThan(initialWidth);
    expect(maximumWidth).toBeGreaterThanOrEqual(415);
    expect(maximumWidth).toBeLessThanOrEqual(417);

    await userEvent.keyboard("{ArrowLeft>60}");

    const minimumWidth = width();
    expect(minimumWidth).toBeLessThan(initialWidth);
    expect(minimumWidth).toBeGreaterThanOrEqual(191);
    expect(minimumWidth).toBeLessThanOrEqual(193);
  });
});

async function renderShell() {
  return render(
    <KeyboardShortcutsProvider runtime={keyboardShortcutRuntime()}>
      <ApplicationShell
        desktopUpdates={undefined}
        productVersion="0.0.2-test"
        session={pairingRequiredSession()}
      />
    </KeyboardShortcutsProvider>,
  );
}

async function renderRepositoryWorkspace() {
  return render(
    <KeyboardShortcutsProvider runtime={keyboardShortcutRuntime()}>
      <div style={{ height: 720, width: 900 }}>
        <RepositoryWorkspace
          activeWorktreePath="/repo"
          branchesFocusRequest={0}
          environmentId={undefined}
          historyGateway={{
            read: async () => Promise.reject(new Error("Unavailable")),
          }}
          refs={{
            checkingOut: false,
            refs: {
              branches: [{ name: "main", worktreePath: "/repo" }],
              remoteBranches: [],
              repositoryId: "00000000-0000-4000-8000-000000000001",
              tags: [],
              truncated: {
                branches: false,
                remoteBranches: false,
                tags: false,
              },
              worktrees: [
                {
                  head: { branch: "main", commit: "a".repeat(40) },
                  main: true,
                  path: "/repo",
                },
              ],
            },
            status: "ready",
          }}
          retryRefs={() => undefined}
          repositoryId="00000000-0000-4000-8000-000000000001"
          repositoryName="rebase-test"
          selectRef={() => undefined}
        />
      </div>
    </KeyboardShortcutsProvider>,
  );
}

function keyboardShortcutRuntime() {
  return {
    host: browserKeyboardShortcutHost(),
    store: createKeyboardShortcutStore(memoryStorage()),
  };
}

function pairingRequiredSession(): LocalEnvironmentSession {
  const sessionState = { _tag: "PairingRequired" } as const;
  const catalogSnapshot = { repositories: [], status: "idle" } as const;
  const refsSnapshot = { checkingOut: false, status: "idle" } as const;
  const unsubscribe = () => undefined;
  return {
    filesystem: {
      listDirectory: async () => ({
        breadcrumbs: [],
        entries: [],
        path: "/",
        truncated: false,
      }),
    },
    getSnapshot: () => sessionState,
    repositoryCatalog: {
      getSnapshot: () => catalogSnapshot,
      recordOpened: async () => Promise.reject(new Error("Unavailable")),
      refresh: async () => undefined,
      remember: async () => Promise.reject(new Error("Unavailable")),
      remove: async () => undefined,
      subscribe: () => unsubscribe,
    },
    repositoryHistory: {
      read: async () => Promise.reject(new Error("Unavailable")),
    },
    repositoryRefs: {
      checkout: async () => Promise.reject(new Error("Unavailable")),
      getSnapshot: () => refsSnapshot,
      invalidate: () => undefined,
      refresh: async () => undefined,
      select: () => undefined,
      subscribe: () => unsubscribe,
    },
    start: () => undefined,
    stop: () => undefined,
    subscribe: () => unsubscribe,
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}
