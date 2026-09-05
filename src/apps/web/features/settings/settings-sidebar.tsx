import {
  IconArrowLeft,
  IconDatabase,
  IconKeyboard,
  IconSearch,
  IconSettings,
} from "@tabler/icons-react";
import { type JSX, useState } from "react";
import type { SettingsSection } from "#web/features/settings/settings.contract";
import { Button } from "#web-ui/components/ui/button";
import { Input } from "#web-ui/components/ui/input";

const sections = [
  { icon: IconSettings, id: "general", label: "General" },
  {
    icon: IconKeyboard,
    id: "keyboard-shortcuts",
    label: "Keyboard shortcuts",
  },
  { icon: IconDatabase, id: "history-storage", label: "History storage" },
] as const satisfies ReadonlyArray<{
  readonly icon: typeof IconSettings;
  readonly id: SettingsSection;
  readonly label: string;
}>;

export function SettingsSidebar({
  closeSettings,
  section,
  selectSection,
}: {
  readonly closeSettings: () => void;
  readonly section: SettingsSection;
  readonly selectSection: (section: SettingsSection) => void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const visibleSections = sections.filter(({ label }) =>
    label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  return (
    <nav
      aria-label="Settings"
      className="flex h-full w-48 shrink-0 flex-col overflow-hidden border-sidebar-border/50 border-r bg-sidebar text-sidebar-foreground md:w-64"
    >
      <div className="flex h-11 shrink-0 items-center px-4">
        <h1 className="text-base font-semibold text-sidebar-accent-foreground">
          Settings
        </h1>
      </div>
      <div className="relative mx-3 mt-3">
        <IconSearch
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search settings"
          className="pl-9"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search settings..."
          value={query}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-3">
        {visibleSections.map((item) => {
          const Icon = item.icon;
          const selected = item.id === section;

          return (
            <button
              aria-current={selected ? "page" : undefined}
              className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-current-page:bg-sidebar-accent aria-current-page:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/40"
              key={item.id}
              onClick={() => selectSection(item.id)}
              type="button"
            >
              <Icon aria-hidden="true" className="size-4.5" />
              {item.label}
            </button>
          );
        })}
        {visibleSections.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            No settings found
          </p>
        ) : null}
      </div>
      <div className="shrink-0 px-3 pb-2" data-slot="settings-back">
        <Button
          className="h-10 w-full justify-start px-2 text-muted-foreground"
          onClick={closeSettings}
          variant="ghost"
        >
          <IconArrowLeft aria-hidden="true" data-icon="inline-start" />
          Back
        </Button>
      </div>
    </nav>
  );
}
