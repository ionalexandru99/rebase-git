import { useRef } from "react";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { ScrollTopButton } from "#web/components/ui/scroll-top-button.tsx";

function ScrolledRegion() {
  const region = useRef<HTMLElement>(null);
  return (
    <section ref={region}>
      <ScrollTopButton region={region} />
      {["First", "Second"].map((name) => (
        <ul aria-label={name} className="h-20 overflow-y-auto" key={name}>
          <li className="h-80" />
        </ul>
      ))}
    </section>
  );
}

it("appears once a list in its region scrolls and jumps every list back to the top", async () => {
  // Arrange
  const screen = await render(<ScrolledRegion />);
  const button = screen.getByRole("button", {
    name: "Scroll to top",
    includeHidden: true,
  });
  const lists = ["First", "Second"].map((name) =>
    screen.getByRole("list", { name }).element(),
  );
  await expect.element(button).not.toBeVisible();

  // Act
  for (const list of lists) list.scrollTop = 120;
  await expect.element(button).toBeVisible();
  await userEvent.click(button);

  // Assert
  await expect.poll(() => lists.map((list) => list.scrollTop)).toEqual([0, 0]);
  await expect.element(button).not.toBeVisible();
});
