import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import {
  DiagnosticsApi,
  type DiagnosticsEvent,
} from "#contracts/diagnostics/diagnostics.contract.ts";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import {
  catalogEntry,
  diagnosticsError,
  diagnosticsProcess,
  diagnosticsSample,
  repositoryId,
} from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { DiagnosticsSettings } from "#web/features/diagnostics/diagnostics-settings.tsx";
import type { EnvironmentSubscriptions } from "#web/platform/query/environment-context.tsx";

function renderDiagnostics(events: readonly DiagnosticsEvent[]) {
  const periods: unknown[] = [];
  const stopped: unknown[] = [];
  const watched: unknown[] = [];
  const subscribe = (async (_route, input, accept, signal) => {
    periods.push(input);
    for (const event of events) accept(event as never);
    await new Promise((resolve) => signal.addEventListener("abort", resolve));
  }) as EnvironmentSubscriptions;
  const rendered = render(<DiagnosticsSettings productVersion="0.0.7" />, {
    environment: {
      subscribe,
      requests: fakeRequests(
        respond(RepositoryCatalogApi.list, async () => ({
          repositories: [catalogEntry({ name: "linux", color: "amber" })],
        })),
        respond(DiagnosticsApi.stop, async (input) => {
          stopped.push(input);
          return {};
        }),
        respond(DiagnosticsApi.watchAgain, async (input) => {
          watched.push(input);
          return {};
        }),
      ),
    },
  });
  return { rendered, periods, stopped, watched };
}

describe("diagnostics settings", () => {
  it("shows the process tree, stops a Git run and collapses a parent", async () => {
    const { stopped, periods } = renderDiagnostics([
      diagnosticsSample({
        processes: [
          diagnosticsProcess(),
          diagnosticsProcess({
            pid: 51877,
            parentPid: 4120,
            kind: "Git",
            name: "git",
            command: "git fetch --prune",
            repositoryId,
            stoppable: true,
            cpu: 41,
          }),
        ],
      }),
    ]);

    await expect.element(page.getByText("Rebase server")).toBeVisible();
    await expect.element(page.getByText("Busiest: git · 41%")).toBeVisible();
    await page.getByRole("button", { name: "Stop git fetch --prune" }).click();
    await expect.poll(() => stopped).toEqual([{ pid: 51877 }]);

    await page.getByRole("button", { name: "Collapse Rebase server" }).click();

    await expect
      .element(page.getByText("git fetch --prune"))
      .not.toBeInTheDocument();
    await page.getByRole("radio", { name: "1h" }).click();
    await expect
      .poll(() => periods)
      .toEqual([{ period: "15m" }, { period: "1h" }]);
  });

  it("explains a missing process monitor in place of the process tree", async () => {
    renderDiagnostics([
      diagnosticsSample({
        monitor: {
          _tag: "Unavailable",
          detail: "The process monitor isn't included in this build.",
        },
        processes: [],
        footprint: {
          ...diagnosticsSample().footprint,
          cpu: null,
          memory: null,
          cpuPeak: null,
          memoryPeak: null,
          processes: 0,
        },
      }),
    ]);

    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("The process monitor isn't included in this build.");
    expect(page.getByText("—").elements().length).toBeGreaterThanOrEqual(2);
  });

  it("lists hidden errors, restarts a stopped watcher and copies a report", async () => {
    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    const { watched } = renderDiagnostics([
      {
        _tag: "Errors",
        errors: [
          diagnosticsError(),
          diagnosticsError({
            kind: "Git",
            title: "git fetch exited with 128",
            where: "fatal: Could not resolve host: github.com",
            detail: "fatal: Could not resolve host: github.com",
            repositoryId,
            count: 3,
          }),
        ],
      },
      diagnosticsSample({
        watchers: [
          {
            repositoryId,
            failure: "ENOSPC: System limit for number of file watchers reached",
          },
        ],
      }),
    ]);

    await page
      .getByRole("button", {
        name: "Show details for TypeError: Cannot read properties of undefined (reading 'oid')",
      })
      .click();
    await expect.element(page.getByText(/at readStashEntry/)).toBeVisible();
    await page.getByRole("radio", { name: "Most frequent" }).click();
    await expect.element(page.getByText("×3")).toBeVisible();
    await page.getByRole("button", { name: "Watch again" }).click();
    await expect.poll(() => watched).toEqual([{ repositoryId }]);

    await page.getByRole("button", { name: "Copy report" }).click();

    await expect
      .element(page.getByRole("button", { name: "Copied" }))
      .toBeVisible();
    expect(write.mock.calls[0]?.[0]).toContain("- Rebase 0.0.7 on Linux x64");
    expect(write.mock.calls[0]?.[0]).toContain(
      "#### Git: git fetch exited with 128 (×3)",
    );
  });
});
