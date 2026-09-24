import type { DesktopUpdateSnapshot, DesktopUpdates } from "@rebase/contracts";
import {
  IconDatabase,
  IconSettings,
  type TablerIcon,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import { GeneralSettings } from "#web-ui/features/settings/general-settings";
import { HistoryStorageSettings } from "#web-ui/features/settings/history-storage-settings";

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
