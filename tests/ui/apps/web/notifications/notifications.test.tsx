import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { repositoryScope } from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification.tsx";
import {
  useErrorToast,
  useStatusToast,
} from "#web/features/notifications/notifications.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("notifications", () => {
  it("shows a fixed title over a scrolling body and closes on its own or from its button", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const branch = `feature/${"a".repeat(4_000)}`;
    await render(<Failure body={branch} />);

    await page.getByRole("button", { name: "Fail" }).click();
    const body = page.getByText(branch);
    await expect
      .element(page.getByText("Couldn’t push changes", { exact: true }))
      .toBeVisible();
    const element = body.element();
    expect(element.scrollHeight).toBeGreaterThan(element.clientHeight);
    expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth);

    vi.advanceTimersByTime(8_000);
    await expect.element(body).not.toBeInTheDocument();

    await page.getByRole("button", { name: "Fail" }).click();
    await page.getByRole("button", { name: "Dismiss notification" }).click();
    await expect.element(body).not.toBeInTheDocument();
  });

  it("keeps toasts past three waiting behind the stack and keeps persistent notifications", async () => {
    await render(
      <>
        <Steps />
        <PersistentNotification>
          <p>Rebase in progress</p>
        </PersistentNotification>
      </>,
    );
    const next = page.getByRole("button", { name: "Next step" });
    for (let step = 0; step < 4; step += 1) await next.click();
    const waiting = () =>
      page.getByText("Step 1").element().closest("[inert]") !== null;

    await expect.element(page.getByText("Step 4")).toBeVisible();
    await expect.poll(waiting).toBe(true);
    await page
      .getByRole("button", { name: "Dismiss notification" })
      .first()
      .click();
    await expect.poll(waiting).toBe(false);
    await expect.element(page.getByText("Rebase in progress")).toBeVisible();
  });

  it("turns a progress notification into its result in place", async () => {
    await render(<Push />);

    await page.getByRole("button", { name: "Start" }).click();
    await expect
      .element(page.getByText("Pushing to origin/main"))
      .toBeVisible();
    await page.getByRole("button", { name: "Finish" }).click();

    await expect.element(page.getByText("Pushed to origin/main")).toBeVisible();
    await expect
      .element(page.getByText("Pushing to origin/main"))
      .not.toBeInTheDocument();
    expect(
      page.getByRole("button", { name: "Dismiss notification" }).elements(),
    ).toHaveLength(1);
  });

  it("brings a repeated action to the front of the stack", async () => {
    await render(<Steps />);
    const next = page.getByRole("button", { name: "Next step" });
    const stack = page.getByRole("region", { name: "Notifications" });

    for (let step = 0; step < 5; step += 1) await next.click();

    await expect.element(page.getByText("Step 5")).toBeInTheDocument();
    await expect.element(page.getByText("Step 1")).not.toBeInTheDocument();
    expect(stack.element().textContent).toMatch(/^Couldn’t push changesStep 5/);
  });

  it("names the repository a notification came from and opens it", async () => {
    const openRepository = vi.fn<(repositoryId: string) => void>();
    await render(
      <RepositoryScopeProvider scope={repositoryScope({ repositoryId: "api" })}>
        <Failure />
      </RepositoryScopeProvider>,
      {
        notifications: {
          currentRepositoryId: "web",
          openRepository,
          repositories: [
            { id: "api", name: "api-server" },
            { id: "web", name: "web-app" },
          ],
        },
      },
    );

    await page.getByRole("button", { name: "Fail" }).click();
    await expect.element(page.getByText("api-server")).toBeVisible();
    await page.getByRole("button", { name: "Open api-server" }).click();

    expect(openRepository).toHaveBeenCalledWith("api");
  });

  it("sends a system notification for a result that arrives in the background", async () => {
    const shown =
      vi.fn<(title: string, options: NotificationOptions) => void>();
    vi.stubGlobal(
      "Notification",
      class {
        static readonly permission = "granted";
        onclick: (() => void) | null = null;
        constructor(title: string, options: NotificationOptions) {
          shown(title, options);
        }
        close() {}
      },
    );
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    await render(
      <RepositoryScopeProvider scope={repositoryScope({ repositoryId: "api" })}>
        <Push />
      </RepositoryScopeProvider>,
      {
        notifications: {
          currentRepositoryId: "web",
          repositories: [{ id: "api", name: "api-server" }],
        },
      },
    );

    await page.getByRole("button", { name: "Start" }).click();
    await page.getByRole("button", { name: "Finish" }).click();

    await expect
      .poll(() => shown.mock.calls)
      .toEqual([
        ["Pushed to origin/main", { body: "api-server", tag: "api/push" }],
      ]);
  });
});

function Failure({ body }: { readonly body?: string }) {
  const errorToast = useErrorToast();
  return (
    <button type="button" onClick={() => errorToast.show("push", body)}>
      Fail
    </button>
  );
}

function Steps() {
  const errorToast = useErrorToast();
  const steps = useRef(0);
  const actions = ["push", "pull", "fetch", "merge"] as const;
  return (
    <button
      type="button"
      onClick={() => {
        const action = actions[steps.current] ?? "push";
        steps.current += 1;
        errorToast.show(action, `Step ${steps.current}`);
      }}
    >
      Next step
    </button>
  );
}

function Push() {
  const statusToast = useStatusToast();
  return (
    <>
      <button
        type="button"
        onClick={() => statusToast.progress("push", "Pushing to origin/main")}
      >
        Start
      </button>
      <button
        type="button"
        onClick={() => statusToast.success("push", "Pushed to origin/main")}
      >
        Finish
      </button>
    </>
  );
}
