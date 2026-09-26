import type { DesktopUpdateSnapshot, DesktopUpdates } from "@rebase/contracts";
import { type ComponentType, type JSX, useEffect, useState } from "react";
import {
  type SettingsSectionContext,
  type SettingsSectionId,
  settingsSections,
} from "#web/features/settings/settings-sections";
import { SettingsSidebar } from "#web/features/settings/settings-sidebar";

export function SettingsPanel({
  closeSettings,
  desktopUpdates,
  productVersion,
}: {
  readonly closeSettings: () => void;
  readonly desktopUpdates: DesktopUpdates | undefined;
  readonly productVersion: string;
}): JSX.Element {
  const [sectionId, setSectionId] = useState<SettingsSectionId>("general");
  const Content: ComponentType<SettingsSectionContext> =
    settingsSections.find(({ id }) => id === sectionId)?.Content ??
    settingsSections[0].Content;
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
        section={sectionId}
        selectSection={setSectionId}
      />
      <main
        aria-label="Settings content"
        className="min-w-0 flex-1 overflow-y-auto rounded-none bg-repository"
      >
        <Content
          desktopUpdates={desktopUpdates}
          productVersion={productVersion}
          updateLoadError={updateLoadError}
          updateSnapshot={updateSnapshot}
        />
      </main>
    </div>
  );
}
