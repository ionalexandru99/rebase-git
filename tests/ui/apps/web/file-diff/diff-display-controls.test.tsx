import { useRef, useState } from "react";
import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { defaultDiffPreferences } from "#web/domain/file-diff/diff-preferences.contract.ts";
import { DiffDisplayControls } from "#web/features/file-diff/components/diff-display-controls.tsx";

function Controls({ width }: { readonly width: number }) {
  const region = useRef<HTMLElement>(null);
  const [preferences, setPreferences] = useState(defaultDiffPreferences);
  return (
    <section ref={region} style={{ width }}>
      <DiffDisplayControls
        expanded={false}
        preferences={preferences}
        onPreferences={setPreferences}
        region={region}
      />
    </section>
  );
}

it("folds the display options into a menu when the diff is narrow", async () => {
  // Arrange
  const screen = await render(<Controls width={200} />);
  const wrap = page.getByRole("menuitemcheckbox", { name: "Word wrap" });

  // Act
  await screen.getByRole("button", { name: "View options" }).click();
  await wrap.click();

  // Assert
  await expect.element(wrap).toHaveAttribute("aria-checked", "true");
  await expect
    .element(
      screen.getByRole("button", { name: "Word wrap", includeHidden: true }),
    )
    .not.toBeVisible();
});

it("shows the display options inline when the diff has room", async () => {
  // Arrange
  const screen = await render(<Controls width={400} />);
  const wrap = screen.getByRole("button", { name: "Word wrap" });

  // Act
  await wrap.click();

  // Assert
  await expect.element(wrap).toHaveAttribute("aria-pressed", "true");
  await expect
    .element(
      screen.getByRole("button", { name: "View options", includeHidden: true }),
    )
    .not.toBeVisible();
});
