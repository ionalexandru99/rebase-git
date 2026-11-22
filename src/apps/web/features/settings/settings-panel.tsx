import type { ComponentType, JSX } from "react";
import type { DesktopUpdates } from "#contracts/desktop-updates/desktop-updates.contract.ts";
import { GeneralSettings } from "#web/features/settings/general-settings.tsx";
import {
  type SettingsSectionContext,
  type SettingsSectionId,
  settingsSections,
} from "#web/features/settings/settings-sections.ts";
import { SettingsSidebar } from "#web/features/settings/settings-sidebar.tsx";

export function SettingsPanel({
  section,
  selectSection,
  closeSettings,
  desktopUpdates,
  productVersion,
}: {
  readonly section: SettingsSectionId;
  readonly selectSection: (section: SettingsSectionId) => void;
  readonly closeSettings: () => void;
  readonly desktopUpdates: DesktopUpdates | undefined;
  readonly productVersion: string;
}): JSX.Element {
  const Content: ComponentType<SettingsSectionContext> =
    settingsSections.find(({ id }) => id === section)?.Content ??
    GeneralSettings;

  return (
    <div className="flex h-full min-h-0">
      <SettingsSidebar
        closeSettings={closeSettings}
        section={section}
        selectSection={selectSection}
      />
      <main
        aria-label="Settings content"
        className="min-w-0 flex-1 overflow-y-auto rounded-none bg-repository"
      >
        <Content
          desktopUpdates={desktopUpdates}
          productVersion={productVersion}
          selectSection={selectSection}
        />
      </main>
    </div>
  );
}
