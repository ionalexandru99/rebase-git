import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { fakeRequests } from "#tests-support/fake-requests.ts";
import { repositoryScope } from "#tests-support/fixtures.ts";
import { render, testChanges } from "#tests-support/render.tsx";
import { fakeTerminalServer } from "#tests-support/terminals.ts";
import {
  TerminalSplit,
  TerminalToggle,
} from "#web/features/terminal/terminal-panel.tsx";
import { useTerminals } from "#web/features/terminal/use-terminals.ts";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const environmentId = "00000000-0000-4000-8000-000000000100";
const scope = repositoryScope();

function Workspace() {
  const terminals = useTerminals(environmentId, scope);
  return (
    <div className="flex h-[600px] w-[900px] flex-col">
      <TerminalToggle terminals={terminals} />
      <TerminalSplit terminals={terminals}>
        <button type="button">Graph</button>
      </TerminalSplit>
    </div>
  );
}

async function renderTerminals() {
  localStorage.clear();
  const server = fakeTerminalServer();
  const changes = testChanges();
  const screen = await render(
    <RepositoryScopeProvider scope={scope}>
      <Workspace />
    </RepositoryScopeProvider>,
    {
      queryClient: changes.queryClient,
      environment: {
        requests: fakeRequests(...server.routes),
        subscribe: server.subscribe,
      },
    },
  );
  return { screen, server, changes };
}

describe("terminal panel", () => {
  it("opens a shell from the bottom panel glyph and sends keystrokes in order, one write at a time", async () => {
    const { screen, server } = await renderTerminals();

    await screen.getByRole("button", { name: "Show terminal" }).click();
    await expect
      .element(screen.getByRole("tab", { name: "Terminal 1" }))
      .toHaveAttribute("aria-selected", "true");
    const id = server.terminals[0]?.id ?? "";
    await expect.poll(() => server.attached(id)).toBe(true);
    server.emit(id, "repo \ue0a0 main \u{f02a2} ");
    await expect.element(screen.getByText(/repo .* main/)).toBeInTheDocument();

    const release = server.holdWrites();
    await userEvent.keyboard("ls");
    await expect.poll(() => server.writes.length).toBe(1);
    await userEvent.keyboard(" -la{Enter}");
    release();

    await expect
      .poll(() => server.writes.map(({ data }) => data))
      .toEqual(["l", "s -la\r"]);
    await expect
      .poll(() =>
        [...document.fonts].some(
          (face) =>
            face.family.replaceAll('"', "") === "Symbols Nerd Font Mono" &&
            face.status === "loaded",
        ),
      )
      .toBe(true);
  });

  it("creates, switches, collapses to the rail and closes terminals", async () => {
    const { screen } = await renderTerminals();

    await screen.getByRole("button", { name: "Show terminal" }).click();
    await screen.getByRole("button", { name: "New terminal" }).click();
    await expect
      .element(screen.getByRole("tab", { name: "Terminal 2" }))
      .toHaveAttribute("aria-selected", "true");

    await screen
      .getByRole("button", { name: "Collapse terminal list" })
      .click();
    await screen.getByRole("tab", { name: "Terminal 1" }).click();
    await expect
      .element(screen.getByRole("tab", { name: "Terminal 1" }))
      .toHaveTextContent("1");
    await expect
      .element(screen.getByRole("tab", { name: "Terminal 1" }))
      .toHaveAttribute("aria-selected", "true");

    await screen.getByRole("button", { name: "Expand terminal list" }).click();
    await screen.getByRole("button", { name: "Close Terminal 2" }).click();
    await expect
      .element(screen.getByRole("tab", { name: "Terminal 2" }))
      .not.toBeInTheDocument();

    await screen.getByRole("tab", { name: "Terminal 1" }).click();
    await expect
      .element(screen.getByRole("textbox", { name: "Terminal input" }))
      .toHaveFocus();
    await userEvent.keyboard("{Control>}`{/Control}");
    await expect
      .element(screen.getByRole("button", { name: "Show terminal" }))
      .toHaveFocus();
  });

  it("hides the panel when the last shell exits", async () => {
    const { screen, server, changes } = await renderTerminals();

    await screen.getByRole("button", { name: "Show terminal" }).click();
    await expect
      .element(screen.getByRole("tab", { name: "Terminal 1" }))
      .toBeInTheDocument();
    server.exit(server.terminals[0]?.id ?? "");
    changes.publish([scope.repositoryId], "Terminals");

    await expect
      .element(screen.getByRole("button", { name: "Show terminal" }))
      .toHaveAttribute("aria-expanded", "false");
  });
});
