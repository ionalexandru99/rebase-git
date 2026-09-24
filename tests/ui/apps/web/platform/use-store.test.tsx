import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { createStore } from "#web/platform/store/store";
import { useStore } from "#web/platform/store/use-store";

interface Counter {
  readonly count: number;
  readonly label: string;
}

const selectCount = (state: Counter) => state.count;
const selectLabel = (state: Counter) => state.label;

it("re-renders a component only when its selected slice changes", async () => {
  // Arrange
  const store = createStore<Counter>({ count: 0, label: "idle" });
  let countRenders = 0;
  function Count() {
    countRenders += 1;
    return <output aria-label="Count">{useStore(store, selectCount)}</output>;
  }
  function Label() {
    return <output aria-label="Label">{useStore(store, selectLabel)}</output>;
  }
  await render(
    <>
      <Count />
      <Label />
    </>,
  );
  const mountedRenders = countRenders;

  // Act
  store.set({ ...store.getSnapshot(), label: "busy" });
  await expect
    .element(page.getByRole("status", { name: "Label" }))
    .toHaveTextContent("busy");
  const rendersAfterLabel = countRenders;
  store.set({ ...store.getSnapshot(), count: 1 });

  // Assert
  await expect
    .element(page.getByRole("status", { name: "Count" }))
    .toHaveTextContent("1");
  expect(rendersAfterLabel).toBe(mountedRenders);
  expect(countRenders).toBe(mountedRenders + 1);
});
