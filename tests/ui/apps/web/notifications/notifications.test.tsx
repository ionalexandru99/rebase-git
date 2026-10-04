import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
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
      .element(page.getByText("Couldn't push", { exact: true }))
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

  it("fills the progress ring before the title moves on", async () => {
    await render(<Pull />);
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByRole("button", { name: "Advance" }).click();
    await expect
      .element(page.getByRole("progressbar", { name: "Fetching" }))
      .toHaveAttribute("aria-valuenow", "40");
    const ringWhenPulled = Promise.withResolvers<number>();
    const observer = new MutationObserver(() => {
      if (document.querySelector("h2")?.textContent !== "Pulled") return;
      const arc = document.querySelector("svg g circle:nth-of-type(2)");
      if (arc !== null)
        ringWhenPulled.resolve(
          parseFloat(getComputedStyle(arc).strokeDashoffset),
        );
    });
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    await page.getByRole("button", { name: "Finish" }).click();

    await expect
      .element(page.getByText("Pulled", { exact: true }))
      .toBeVisible();
    observer.disconnect();
    expect(await ringWhenPulled.promise).toBe(0);
  });

  it("brings a repeated action to the front of the stack", async () => {
    await render(<Steps />);
    const next = page.getByRole("button", { name: "Next step" });
    const stack = page.getByRole("region", { name: "Notifications" });

    for (let step = 0; step < 5; step += 1) await next.click();

    await expect.element(page.getByText("Step 5")).toBeInTheDocument();
    await expect.element(page.getByText("Step 1")).not.toBeInTheDocument();
    expect(stack.element().textContent).toMatch(/^Couldn't pushStep 5/);
  });

  it("puts the action at the bottom right, reachable by keyboard, and closes the toast when used", async () => {
    const undo = vi.fn<() => void>();
    await render(<Undoable undo={undo} />);

    await page.getByRole("button", { name: "Delete" }).click();
    const title = page.getByText("Deleted feature/login", { exact: true });
    const action = page.getByRole("button", { name: "Undo" });
    await expect.element(action).toBeVisible();
    const text = title.element().getBoundingClientRect();
    const button = action.element().getBoundingClientRect();
    const dismiss = page
      .getByRole("button", { name: "Dismiss notification" })
      .element()
      .getBoundingClientRect();
    expect(button.top).toBeGreaterThanOrEqual(text.bottom);
    expect(button.right).toBe(dismiss.right);

    await userEvent.keyboard("{F6}");
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await expect.element(action).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    expect(undo).toHaveBeenCalledOnce();
    await expect.element(title).not.toBeInTheDocument();
  });

  it("centers the icon, title and dismiss button of a title-only toast", async () => {
    await render(<Push />);

    await page.getByRole("button", { name: "Finish" }).click();

    const title = page.getByText("Pushed to origin/main", { exact: true });
    await expect.element(title).toBeVisible();
    const dismiss = page.getByRole("button", { name: "Dismiss notification" });
    const card = page.getByRole("dialog", { name: "Pushed to origin/main" });
    const icon = card.element().querySelector("svg");
    const middle = (element: Element | null | undefined) => {
      const box = element?.getBoundingClientRect();
      return box === undefined ? Number.NaN : box.top + box.height / 2;
    };
    expect(
      [title.element(), dismiss.element(), icon, card.element()].map(middle),
    ).toEqual(Array(4).fill(middle(title.element())));
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
    expect(
      page
        .getByRole("region", { name: "Notifications" })
        .getByRole("button")
        .elements()
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Dismiss notification", "Open api-server"]);
    await page.getByRole("button", { name: "Open api-server" }).click();

    expect(openRepository).toHaveBeenCalledWith("api");
  });

  it("sends a system notification with the first line of a result that arrives in the background", async () => {
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
        <Failure
          body={"origin/main rejected the push.\n\nremote: protected branch"}
        />
      </RepositoryScopeProvider>,
      {
        notifications: {
          currentRepositoryId: "web",
          repositories: [{ id: "api", name: "api-server" }],
        },
      },
    );

    await page.getByRole("button", { name: "Fail" }).click();

    await expect
      .poll(() => shown.mock.calls)
      .toEqual([
        [
          "Couldn't push",
          {
            body: "api-server\norigin/main rejected the push.",
            tag: "api/push",
          },
        ],
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

function Pull() {
  const statusToast = useStatusToast();
  return (
    <>
      <button
        type="button"
        onClick={() => statusToast.progress("pull", "Fetching", { percent: 0 })}
      >
        Start
      </button>
      <button type="button" onClick={() => statusToast.advance("pull", 40)}>
        Advance
      </button>
      <button
        type="button"
        onClick={() => statusToast.success("pull", "Pulled")}
      >
        Finish
      </button>
    </>
  );
}

function Undoable({ undo }: { readonly undo: () => void }) {
  const statusToast = useStatusToast();
  return (
    <button
      type="button"
      onClick={() =>
        statusToast.success("deleteBranch", "Deleted feature/login", undo)
      }
    >
      Delete
    </button>
  );
}
