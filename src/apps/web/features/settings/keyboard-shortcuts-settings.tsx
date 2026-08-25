import type { JSX, ReactNode } from "react";

const commandKey = "Ctrl/⌘";

export function KeyboardShortcutsSettings(): JSX.Element {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 pt-10 pb-16 sm:px-8 sm:pt-12">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          Keyboard shortcuts
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Move through Rebase without leaving the keyboard.
        </p>
      </header>

      <section aria-labelledby="navigation-shortcuts" className="mt-10">
        <h2 className="text-lg font-semibold" id="navigation-shortcuts">
          Navigation
        </h2>
        <div className="mt-3 space-y-1">
          <ShortcutRow
            keys={[commandKey, "Shift", "O"]}
            label="Show Open Project"
          />
          <ShortcutRow
            keys={[commandKey, "O"]}
            label="Browse for a repository"
          />
          <ShortcutRow
            keys={[commandKey, "W"]}
            label="Close active repository"
          />
          <ShortcutRow
            keys={[commandKey, "B"]}
            label="Toggle project sidebar"
          />
          <ShortcutRow
            keys={[commandKey, "Shift", "F"]}
            label="Focus sidebar filter"
          />
          <ShortcutRow keys={[commandKey, ","]} label="Open settings" />
          <ShortcutRow keys={["Esc"]} label="Close the active panel" />
        </div>
      </section>

      <section aria-labelledby="list-shortcuts" className="mt-10">
        <h2 className="text-lg font-semibold" id="list-shortcuts">
          Search and lists
        </h2>
        <div className="mt-3 space-y-1">
          <ShortcutRow
            keys={[commandKey, "F"]}
            label="Focus the current search"
          />
          <ShortcutRow keys={["↑", "↓"]} label="Move through results" />
          <ShortcutRow keys={["Enter"]} label="Open the active result" />
        </div>
      </section>

      <section aria-labelledby="folder-shortcuts" className="mt-10">
        <h2 className="text-lg font-semibold" id="folder-shortcuts">
          Folder picker
        </h2>
        <div className="mt-3 space-y-1">
          <ShortcutRow keys={["←"]} label="Open the parent folder" />
          <ShortcutRow keys={["→"]} label="Enter the selected folder" />
          <ShortcutRow keys={["Alt", "↑"]} label="Open the parent folder" />
          <ShortcutRow
            keys={[commandKey, "Enter"]}
            label="Open the selected repository"
          />
        </div>
      </section>
    </div>
  );
}

function ShortcutRow({
  keys,
  label,
}: {
  readonly keys: readonly string[];
  readonly label: ReactNode;
}): JSX.Element {
  return (
    <div className="flex min-h-16 items-center justify-between gap-8 rounded-xl px-3 py-3 hover:bg-background/35 sm:px-4">
      <span className="text-sm font-medium">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        {keys.map((key) => (
          <kbd
            className="min-w-7 rounded-md border border-border bg-secondary px-2 py-1 text-center font-sans text-xs font-medium text-secondary-foreground shadow-sm"
            key={key}
          >
            {key}
          </kbd>
        ))}
      </span>
    </div>
  );
}
