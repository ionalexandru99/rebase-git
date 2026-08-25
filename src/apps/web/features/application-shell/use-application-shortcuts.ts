import { useEffect } from "react";
import type { EnvironmentAvailability } from "#web/features/project-navigation/project-navigation.contract";

export function useApplicationShortcuts({
  availability,
  closeSelectedRepository,
  folderPickerOpen,
  focusSidebarFilter,
  hasSelectedRepository,
  openFolderPicker,
  openSettings,
  settingsOpen,
  showOpenProject,
  toggleSidebar,
}: {
  readonly availability: EnvironmentAvailability;
  readonly closeSelectedRepository: () => void;
  readonly folderPickerOpen: boolean;
  readonly focusSidebarFilter: () => void;
  readonly hasSelectedRepository: boolean;
  readonly openFolderPicker: () => void;
  readonly openSettings: (open: boolean) => void;
  readonly settingsOpen: boolean;
  readonly showOpenProject: () => void;
  readonly toggleSidebar: () => void;
}) {
  useEffect(() => {
    const handleApplicationShortcut = (event: KeyboardEvent) => {
      if (folderPickerOpen) return;

      if (event.key === "Escape" && settingsOpen) {
        event.preventDefault();
        openSettings(false);
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

      const key = event.key.toLocaleLowerCase();
      if (key === "," && !event.shiftKey) {
        event.preventDefault();
        openSettings(true);
        return;
      }

      if (key === "o") {
        event.preventDefault();
        openSettings(false);
        if (event.shiftKey || availability !== "available") showOpenProject();
        else openFolderPicker();
        return;
      }

      if (key === "w" && !event.shiftKey) {
        if (hasSelectedRepository) {
          event.preventDefault();
          closeSelectedRepository();
        }
        return;
      }

      if (key === "f" && event.shiftKey) {
        event.preventDefault();
        focusSidebarFilter();
        return;
      }

      if (key === "b" && !event.shiftKey && !settingsOpen) {
        event.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", handleApplicationShortcut);
    return () =>
      window.removeEventListener("keydown", handleApplicationShortcut);
  }, [
    availability,
    closeSelectedRepository,
    folderPickerOpen,
    focusSidebarFilter,
    hasSelectedRepository,
    openFolderPicker,
    openSettings,
    settingsOpen,
    showOpenProject,
    toggleSidebar,
  ]);
}
