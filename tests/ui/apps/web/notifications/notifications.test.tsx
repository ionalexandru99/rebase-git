import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "#tests-support/render.tsx";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";

afterEach(() => {
  vi.useRealTimers();
});

describe("error toasts", () => {
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

  it("closes the oldest toast for good past three and keeps persistent notifications", async () => {
    await render(
      <>
        <Failure />
        <PersistentNotification>
          <p>Rebase in progress</p>
        </PersistentNotification>
      </>,
    );
    const fail = page.getByRole("button", { name: "Fail" });
    for (let attempt = 0; attempt < 4; attempt += 1) await fail.click();

    await expect.element(page.getByText("Attempt 4")).toBeVisible();
    await expect.element(page.getByText("Attempt 1")).not.toBeInTheDocument();
    await page
      .getByRole("button", { name: "Dismiss notification" })
      .first()
      .click();
    await expect.element(page.getByText("Attempt 2")).toBeVisible();
    await expect.element(page.getByText("Attempt 1")).not.toBeInTheDocument();
    await expect.element(page.getByText("Rebase in progress")).toBeVisible();
  });
});

function Failure({ body }: { readonly body?: string }) {
  const errorToast = useErrorToast();
  const attempts = useRef(0);
  return (
    <button
      type="button"
      onClick={() => {
        attempts.current += 1;
        errorToast.show("push", body ?? `Attempt ${attempts.current}`);
      }}
    >
      Fail
    </button>
  );
}
