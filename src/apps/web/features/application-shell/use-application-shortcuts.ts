import { useEffect } from "react";
import {
  isEditableShortcutTarget,
  keyboardShortcutPlatform,
  matchesKeyboardShortcut,
} from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import type { KeyboardShortcutCommandId } from "#web/features/keyboard-shortcuts/keyboard-shortcuts.contract";
import { useKeyboardShortcuts } from "#web/features/keyboard-shortcuts/use-keyboard-shortcuts";
import type { EnvironmentAvailability } from "#web/features/project-navigation/project-navigation.contract";

export function useApplicationShortcuts({
  availability,
  closeSelectedRepository,
  folderPickerOpen,
  focusSidebarFilter,
  hasSelectedRepository,
  openFolderPicker,
  openSettings,
  selectNextRepository,
  selectPreviousRepository,
  selectRepositoryByPosition,
  selectableRepositoryCount,
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
  readonly selectNextRepository: () => void;
  readonly selectPreviousRepository: () => void;
  readonly selectRepositoryByPosition: (position: number) => void;
  readonly selectableRepositoryCount: number;
  readonly settingsOpen: boolean;
  readonly showOpenProject: () => void;
  readonly toggleSidebar: () => void;
}) {
  const { bindings } = useKeyboardShortcuts();

  useEffect(() => {
    const handleApplicationShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (folderPickerOpen) return;

      if (event.key === "Escape" && settingsOpen) {
        event.preventDefault();
        openSettings(false);
        return;
      }

      if (settingsOpen || isEditableShortcutTarget(event.target)) return;
      const execute = (
        commandId: KeyboardShortcutCommandId,
        enabled: boolean,
        action: () => void,
      ) => {
        if (
          !enabled ||
          !matchesKeyboardShortcut(
            event,
            bindings[commandId],
            keyboardShortcutPlatform(),
          )
        ) {
          return false;
        }
        event.preventDefault();
        action();
        return true;
      };

      if (execute("settings.open", true, () => openSettings(true))) return;
      if (execute("projects.showOpenProject", true, showOpenProject)) return;
      if (
        execute(
          "projects.browseRepository",
          availability === "available",
          openFolderPicker,
        )
      ) {
        return;
      }
      if (
        execute(
          "projects.closeActiveRepository",
          hasSelectedRepository,
          closeSelectedRepository,
        )
      ) {
        return;
      }
      if (execute("projects.focusFilter", true, focusSidebarFilter)) return;
      if (execute("projects.toggleSidebar", true, toggleSidebar)) return;
      if (
        execute(
          "projects.selectPreviousRepository",
          selectableRepositoryCount > 0,
          selectPreviousRepository,
        )
      ) {
        return;
      }
      if (
        execute(
          "projects.selectNextRepository",
          selectableRepositoryCount > 0,
          selectNextRepository,
        )
      ) {
        return;
      }
      for (let position = 1; position <= 9; position += 1) {
        const commandId =
          `projects.selectRepository${position}` as KeyboardShortcutCommandId;
        const available =
          position === 9
            ? selectableRepositoryCount > 0
            : position <= selectableRepositoryCount;
        if (
          execute(commandId, available, () =>
            selectRepositoryByPosition(position),
          )
        ) {
          return;
        }
      }
    };

    window.addEventListener("keydown", handleApplicationShortcut);
    return () =>
      window.removeEventListener("keydown", handleApplicationShortcut);
  }, [
    availability,
    bindings,
    closeSelectedRepository,
    folderPickerOpen,
    focusSidebarFilter,
    hasSelectedRepository,
    openFolderPicker,
    openSettings,
    selectNextRepository,
    selectPreviousRepository,
    selectRepositoryByPosition,
    selectableRepositoryCount,
    settingsOpen,
    showOpenProject,
    toggleSidebar,
  ]);
}
