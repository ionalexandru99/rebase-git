import type { DesktopUpdateSnapshot, DesktopUpdates } from "@rebase/contracts";
import type { TablerIcon } from "@tabler/icons-react";
import type { ComponentType } from "react";

export interface SettingsSectionContext {
  readonly desktopUpdates: DesktopUpdates | undefined;
  readonly productVersion: string;
  readonly updateLoadError: string | undefined;
  readonly updateSnapshot: DesktopUpdateSnapshot | undefined;
}

export interface SettingsSectionDefinition<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly icon: TablerIcon;
  readonly Content: ComponentType<SettingsSectionContext>;
}
