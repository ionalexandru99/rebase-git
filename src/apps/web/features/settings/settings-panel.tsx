import { type ComponentType, type JSX, useEffect, useState } from "react";
import type {
  DesktopUpdateSnapshot,
  DesktopUpdates,
} from "#contracts/desktop-updates/desktop-updates.contract.ts";
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
  const [updateSnapshot, setUpdateSnapshot] = useState<DesktopUpdateSnapshot>();
  const [updateLoadError, setUpdateLoadError] = useState<string>();

  useEffect(() => {
    if (desktopUpdates === undefined) {
      setUpdateSnapshot(undefined);
      setUpdateLoadError(undefined);
      return;
    }

    let active = true;
    let receivedSubscriptionSnapshot = false;
    setUpdateLoadError(undefined);
    const unsubscribe = desktopUpdates.subscribe((snapshot) => {
      if (active) {
        receivedSubscriptionSnapshot = true;
        setUpdateLoadError(undefined);
        setUpdateSnapshot(snapshot);
      }
    });
    void desktopUpdates
      .getSnapshot()
      .then((snapshot) => {
        if (active && !receivedSubscriptionSnapshot) {
          setUpdateLoadError(undefined);
          setUpdateSnapshot(snapshot);
        }
      })
      .catch((error: unknown) => {
        if (active && !receivedSubscriptionSnapshot) {
          setUpdateLoadError(
            error instanceof Error
              ? error.message
              : "Update settings could not be loaded.",
          );
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [desktopUpdates]);

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
          updateLoadError={updateLoadError}
          updateSnapshot={updateSnapshot}
        />
      </main>
    </div>
  );
}
