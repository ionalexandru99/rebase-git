import {
  IconDatabase,
  IconSettings,
  type TablerIcon,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import type {
  DesktopUpdateSnapshot,
  DesktopUpdates,
} from "#contracts/desktop-updates/desktop-updates.contract.ts";
import { GeneralSettings } from "#web/features/settings/general-settings.tsx";
import { HistoryStorageSettings } from "#web/features/settings/history-storage-settings.tsx";

export interface SettingsSectionContext {
  readonly desktopUpdates: DesktopUpdates | undefined;
  readonly productVersion: string;
  readonly updateLoadError: string | undefined;
  readonly updateSnapshot: DesktopUpdateSnapshot | undefined;
}

interface SettingsSectionDefinition {
  readonly id: string;
  readonly label: string;
  readonly icon: TablerIcon;
  readonly Content: ComponentType<SettingsSectionContext>;
}

export const settingsSections = [
  {
    id: "general",
    label: "General",
    icon: IconSettings,
    Content: GeneralSettings,
  },
  {
    id: "history-storage",
    label: "History storage",
    icon: IconDatabase,
    Content: HistoryStorageSettings,
  },
] as const satisfies readonly SettingsSectionDefinition[];

export type SettingsSectionId = (typeof settingsSections)[number]["id"];
