import {
  CommitInspectionHttpApi,
  isRouteOk,
  RepositoryChangesHttpApi,
  type RouteSuccess,
} from "@rebase/contracts";
import {
  type EnvironmentRequestClient,
  environmentHttpRoutesClient,
  type RequestableEnvironmentHttpRoute,
} from "@rebase/environment-client";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { ResizablePanel } from "#web-ui/components/ui/resizable";
import { WorkspacePanel } from "#web-ui/features/workspace-panel/index";
import { useWorkspacePanel } from "#web-ui/features/workspace-panel/workspace-panel-provider";

const runtime = ManagedRuntime.make(Layer.empty);
const oid = "a".repeat(40);
const parentOid = "b".repeat(40);

async function fixture(linkedWorktree = false) {
  localStorage.clear();
  const projectA = crypto.randomUUID();
  const projectB = crypto.randomUUID();
  const reads: string[] = [];
  const diffs: string[] = [];
  const inspections: string[] = [];
  const cancelled: string[] = [];
  const foreignRequests: string[] = [];
  let holdReads = false;
  let holdInspections = false;
  const respond = <Route extends RequestableEnvironmentHttpRoute, Error>(
    endpoint: Route,
    command: unknown,
    disconnected: () => Error,
  ): Effect.Effect<RouteSuccess<Route>, Error> =>
    Effect.suspend(() => {
      let response: unknown;
      if (endpoint.path === RepositoryChangesHttpApi.read.path) {
        const scope = Schema.decodeUnknownSync(
          RepositoryChangesHttpApi.read.request,
        )(command);
        reads.push(scope.repositoryId);
        if (holdReads) {
          return Effect.never.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                cancelled.push(scope.repositoryId);
              }),
            ),
          );
        }
        response = {
          revision: "one",
          head: oid,
          message: "Previous message",
          unstaged: [
            { path: "first.bin", previousPath: null, status: "M" },
            { path: "second.bin", previousPath: null, status: "M" },
          ],
          staged: [],
          truncated: false,
          renamesLimited: false,
        };
      } else if (endpoint.path === CommitInspectionHttpApi.inspect.path) {
        const scope = Schema.decodeUnknownSync(
          CommitInspectionHttpApi.inspect.request,
        )(command);
        inspections.push(scope.oid);
        if (holdInspections) {
          return Effect.never.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                cancelled.push(scope.oid);
              }),
            ),
          );
        }
        response = {
          oid: scope.oid,
          parentOid,
          parents: [parentOid],
          message: "Inspected commit\n\nRetained body",
          author: {
            name: "Alex",
            email: "alex@example.test",
            date: "2026-09-15T10:00:00Z",
          },
          committer: {
            name: "Alex",
            email: "alex@example.test",
            date: "2026-09-15T10:00:00Z",
          },
          files: [
            { path: "first.bin", status: "M", previousPath: null },
            { path: "second.bin", status: "M", previousPath: null },
          ],
          truncated: false,
        };
      } else {
        const scope =
          endpoint.path === CommitInspectionHttpApi.inspectDiff.path
            ? Schema.decodeUnknownSync(
                CommitInspectionHttpApi.inspectDiff.request,
              )(command)
            : Schema.decodeUnknownSync(RepositoryChangesHttpApi.diff.request)(
                command,
              );
        diffs.push(`${endpoint.path}:${scope.path}`);
        response = {
          path: scope.path,
          revision: scope.path,
          kind: "binary",
          before: null,
          after: null,
          beforeBytes: 10,
          afterBytes: 20,
          mime: null,
          patch: "",
        };
      }
      return Schema.decodeUnknownEffect(endpoint.response)({
        _tag: "Ok",
        value: response,
      }).pipe(
        Effect.mapError(disconnected),
        Effect.flatMap((result) =>
          isRouteOk(result)
            ? Effect.succeed(result.value)
            : Effect.fail(disconnected()),
        ),
      );
    });
  const requests: EnvironmentRequestClient = (routes, errors) =>
    environmentHttpRoutesClient(routes, (endpoint, command) =>
      respond(endpoint, command, errors.disconnected),
    );
  const foreignClient: EnvironmentRequestClient = (routes, errors) =>
    environmentHttpRoutesClient(routes, (endpoint, command) => {
      foreignRequests.push(endpoint.path);
      return respond(endpoint, command, errors.disconnected);
    });
  const tree = (
    project: string,
    repositoryIds: readonly string[] = [projectA, projectB],
    connected = true,
    environmentId = "environment",
  ) => (
    <div style={{ width: 1200, height: 700 }}>
      <WorkspacePanel.Sessions
        environment={{
          environmentId,
          requests: environmentId === "environment" ? requests : foreignClient,
          connected,
          writable: connected,
          runtime,
        }}
        repositoryIds={repositoryIds}
      >
        <WorkspacePanel.Provider
          key={project}
          scopeKey={linkedWorktree ? "shared-worktree" : project}
          scope={{
            environmentId: "environment",
            logicalRepositoryId: linkedWorktree ? "shared-logical" : project,
            repositoryId: project,
            worktreePath: linkedWorktree
              ? "/repos/linked"
              : `/repos/${project}`,
          }}
        >
          <WorkspacePanel.Group>
            <ResizablePanel id="graph" minSize="20%">
              <WorkspacePanel.Toggle />
              <Inspect />
            </ResizablePanel>
            <WorkspacePanel.Pane />
          </WorkspacePanel.Group>
        </WorkspacePanel.Provider>
      </WorkspacePanel.Sessions>
    </div>
  );
  const view = await render(tree(projectA));
  return {
    view,
    reads,
    diffs,
    inspections,
    cancelled,
    foreignRequests,
    projectA,
    projectB,
    show: (project: string, repositoryIds?: string[], connected?: boolean) =>
      view.rerender(tree(project, repositoryIds, connected)),
    showEnvironment: (environmentId: string) =>
      view.rerender(tree(projectA, undefined, true, environmentId)),
    holdReads: () => {
      holdReads = true;
    },
    holdInspections: () => {
      holdInspections = true;
    },
  };
}

function Inspect() {
  const panel = useWorkspacePanel();
  return (
    <button
      type="button"
      onClick={() => {
        panel.execute({ type: "input", kind: "commit", input: oid });
        panel.execute({ type: "open", kind: "commit" });
      }}
    >
      Inspect commit
    </button>
  );
}

async function openDiffs() {
  await page.getByRole("button", { name: "Show side panel" }).click();
  await page
    .getByRole("button", { name: "Diffs Review and commit working changes" })
    .click();
  await expect
    .element(page.getByRole("button", { name: "Stage entire file" }))
    .toBeEnabled();
}

it("retains actual working-change selection, filter, draft and amend state across hide, project changes and reconnect", async () => {
  const f = await fixture();
  await openDiffs();
  await page
    .getByRole("button", { name: "Unstaged second.bin", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Filter changed files" })
    .fill("second");
  await page.getByRole("checkbox", { name: "Amend", exact: true }).click();
  await expect
    .element(page.getByRole("checkbox", { name: "Amend", exact: true }))
    .toBeChecked();
  await page
    .getByRole("textbox", { name: "Commit subject" })
    .fill("Retain my amendment");
  await page.getByRole("button", { name: "Hide side panel" }).click();
  await page.getByRole("button", { name: "Show side panel" }).click();
  await f.show(f.projectB);
  await openDiffs();
  await expect
    .element(page.getByRole("textbox", { name: "Filter changed files" }))
    .toHaveValue("");
  await f.show(f.projectA);
  await f.show(f.projectA, undefined, false);
  await f.show(f.projectA);
  await expect
    .element(page.getByRole("textbox", { name: "Filter changed files" }))
    .toHaveValue("second");
  await expect
    .element(page.getByRole("checkbox", { name: "Amend", exact: true }))
    .toBeChecked();
  await expect
    .element(page.getByRole("textbox", { name: "Commit subject" }))
    .toHaveValue("Retain my amendment");
  await expect
    .element(page.getByRole("button", { name: "Previous file", exact: true }))
    .toBeEnabled();
  await expect
    .element(page.getByRole("button", { name: "Next file", exact: true }))
    .toBeDisabled();
});

it("retains an inspected commit and file while another tab and another project are active", async () => {
  const f = await fixture();
  await openDiffs();
  await page.getByRole("button", { name: "Inspect commit" }).click();
  await page
    .getByRole("button", { name: "second.bin Modified", exact: true })
    .click();
  await expect
    .poll(() => f.diffs.at(-1))
    .toBe(`${CommitInspectionHttpApi.inspectDiff.path}:second.bin`);
  const count = f.inspections.length;
  await page.getByRole("tab", { name: "Diffs", exact: true }).click();
  await page.getByRole("tab", { name: "Commit", exact: true }).click();
  await page.getByRole("button", { name: "Hide side panel" }).click();
  await f.show(f.projectB);
  await f.show(f.projectA);
  await page.getByRole("button", { name: "Show side panel" }).click();
  await expect
    .element(
      page.getByRole("button", { name: "second.bin Modified", exact: true }),
    )
    .toHaveAttribute("aria-pressed", "true");
  expect(f.inspections).toHaveLength(count);
  expect(f.foreignRequests).toEqual([]);
});

it("interrupts reads when a project deactivates and releases its feature sessions when closed", async () => {
  const f = await fixture();
  await openDiffs();
  f.holdReads();
  await page.getByRole("button", { name: "Hide side panel" }).click();
  await page.getByRole("button", { name: "Show side panel" }).click();
  await expect.poll(() => f.reads.length).toBe(2);
  await f.show(f.projectB);
  await expect.poll(() => f.cancelled.includes(f.projectA)).toBe(true);
  await f.show(f.projectB, [f.projectB]);
  await f.show(f.projectA);
  await expect
    .element(page.getByRole("textbox", { name: "Filter changed files" }))
    .toHaveValue("");
  f.holdInspections();
  await page.getByRole("button", { name: "Inspect commit" }).click();
  await expect.poll(() => f.inspections.length).toBe(1);
  await page.getByRole("button", { name: "Close Commit tab" }).click();
  await expect.poll(() => f.cancelled.includes(oid)).toBe(true);
});

it("keeps linked-worktree catalog projects independent when their other owner closes", async () => {
  const f = await fixture(true);
  await openDiffs();
  await page
    .getByRole("textbox", { name: "Filter changed files" })
    .fill("first");
  await f.show(f.projectB);
  await openDiffs();
  await page
    .getByRole("button", { name: "Unstaged second.bin", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Filter changed files" })
    .fill("second");
  await f.show(f.projectB, [f.projectB]);
  await expect
    .element(page.getByRole("textbox", { name: "Filter changed files" }))
    .toHaveValue("second");
  await page.getByRole("button", { name: "Hide side panel" }).click();
  await page.getByRole("button", { name: "Show side panel" }).click();
  await expect.poll(() => f.reads.at(-1)).toBe(f.projectB);
  await expect
    .element(page.getByRole("button", { name: "Previous file", exact: true }))
    .toBeEnabled();
});

it("pauses retained sessions while a different environment is current", async () => {
  const f = await fixture();
  await page.getByRole("button", { name: "Inspect commit" }).click();
  await page
    .getByRole("button", { name: "second.bin Modified", exact: true })
    .click();
  const count = f.inspections.length;
  await f.showEnvironment("other-environment");
  await expect
    .element(page.getByText("Reconnect to the environment to inspect commits."))
    .toBeVisible();
  await f.showEnvironment("environment");
  await expect
    .element(
      page.getByRole("button", { name: "second.bin Modified", exact: true }),
    )
    .toHaveAttribute("aria-pressed", "true");
  expect(f.inspections).toHaveLength(count);
  expect(f.foreignRequests).toEqual([]);
});
