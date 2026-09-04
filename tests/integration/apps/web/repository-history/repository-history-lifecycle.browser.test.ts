import { expect, it } from "vitest";

it.each([false, true])(
  "hands synchronization to another tab on close, with pagehide suppressed: %s",
  async (suppressPageHide) => {
    const events: string[] = [];
    const channelName = crypto.randomUUID();
    const channel = new BroadcastChannel(channelName);
    channel.onmessage = (event: MessageEvent<string>) =>
      events.push(event.data);
    const query = new URLSearchParams({
      environment: crypto.randomUUID(),
      repository: crypto.randomUUID(),
      events: channelName,
    });
    const url = `${location.origin}/tests/integration/apps/web/repository-history/fixtures/history-reader-page.html?${query}`;
    const first = window.open(`${url}&name=first`);
    let second: Window | null = null;
    try {
      expect(first).not.toBeNull();
      await expect
        .poll(() => events, { timeout: 5_000 })
        .toContain("first:committed");
      second = window.open(`${url}&name=second&read=false`);
      expect(second).not.toBeNull();
      await expect
        .poll(() => second?.document.body.dataset.ready, { timeout: 5_000 })
        .toBe("true");
      if (suppressPageHide)
        first?.addEventListener(
          "pagehide",
          (event) => event.stopImmediatePropagation(),
          { capture: true },
        );
      first?.close();
      await expect
        .poll(() => events, { timeout: 5_000 })
        .toContain("second:committed");
      second?.close();
      await expect
        .poll(() => events, { timeout: 5_000 })
        .toContain("second:aborted");
    } finally {
      first?.close();
      second?.close();
      channel.close();
    }
  },
  20_000,
);

it("reconnects the same reader when a document returns from the back-forward cache", async () => {
  const events: string[] = [];
  const channelName = crypto.randomUUID();
  const channel = new BroadcastChannel(channelName);
  channel.onmessage = (event: MessageEvent<string>) => events.push(event.data);
  const query = new URLSearchParams({
    environment: crypto.randomUUID(),
    repository: crypto.randomUUID(),
    events: channelName,
    name: "restored",
  });
  const popup = window.open(
    `${location.origin}/tests/integration/apps/web/repository-history/fixtures/history-reader-page.html?${query}`,
  );
  try {
    await expect
      .poll(() => events, { timeout: 5_000 })
      .toContain("restored:committed");
    popup?.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
    await expect.poll(() => events).toContain("restored:aborted");
    popup?.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
    await expect
      .poll(
        () => events.filter((event) => event === "restored:committed").length,
        { timeout: 5_000 },
      )
      .toBe(2);
    expect(popup?.document.body.dataset.synchronization).toBe("syncing");
  } finally {
    popup?.close();
    channel.close();
  }
}, 20_000);
