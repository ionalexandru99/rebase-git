import { IconSettings } from "@tabler/icons-react";
import {
  keyboardShortcutAria,
  keyboardShortcutTitle,
} from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import { useKeyboardShortcuts } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";

export function RepositorySettingsButton({
  name,
  onOpen,
  active = false,
}: {
  readonly name: string;
  readonly onOpen: () => void;
  readonly active?: boolean;
}) {
  const { bindings, platform } = useKeyboardShortcuts();
  const binding = active ? bindings["repository.openSettings"] : null;
  return (
    <button
      aria-label={`Repository settings for ${name}`}
      aria-keyshortcuts={keyboardShortcutAria(binding, platform)}
      className="grid size-7.5 shrink-0 place-items-center border-0 bg-transparent text-muted-foreground opacity-0 outline-none hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
      onClick={onOpen}
      title={keyboardShortcutTitle(
        `Repository settings for ${name}`,
        binding,
        platform,
      )}
      type="button"
    >
      <IconSettings aria-hidden="true" className="size-4" />
    </button>
  );
}
