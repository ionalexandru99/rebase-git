"use client";

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { cn } from "#web/lib/utils.ts";

function ContextMenu(props: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger(props: ContextMenuPrimitive.Trigger.Props) {
  return (
    <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
  );
}

function ContextMenuContent({
  children,
  className,
  submenu = false,
  ...props
}: ContextMenuPrimitive.Popup.Props & { readonly submenu?: boolean }) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        {...(submenu ? { side: "right" as const, sideOffset: 4 } : {})}
      >
        <ContextMenuPrimitive.Popup
          className={cn(
            "w-50 rounded-[.55rem] border border-border bg-popover p-[.3rem] text-popover-foreground shadow-[0_.75rem_2.5rem_rgb(0_0_0/45%)] outline-none",
            className,
          )}
          data-slot="context-menu-content"
          {...props}
        >
          {children}
        </ContextMenuPrimitive.Popup>
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  ...props
}: ContextMenuPrimitive.Item.Props) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        "flex h-8 cursor-default items-center gap-2 rounded-[.35rem] px-2 text-[.85rem] text-foreground/80 outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-45 data-highlighted:bg-accent data-highlighted:text-foreground",
        className,
      )}
      data-slot="context-menu-item"
      {...props}
    />
  );
}

function ContextMenuSubmenuTrigger({
  className,
  ...props
}: ContextMenuPrimitive.SubmenuTrigger.Props) {
  return (
    <ContextMenuPrimitive.SubmenuTrigger
      className={cn(
        "flex h-8 cursor-default items-center gap-2 rounded-[.35rem] px-2 text-[.85rem] text-foreground/80 outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-45 data-highlighted:bg-accent data-highlighted:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground",
        className,
      )}
      data-slot="context-menu-submenu-trigger"
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: ContextMenuPrimitive.Separator.Props) {
  return (
    <ContextMenuPrimitive.Separator
      className={cn("mx-1 my-1 h-px bg-border", className)}
      data-slot="context-menu-separator"
      {...props}
    />
  );
}

const ContextMenuSubmenu = ContextMenuPrimitive.SubmenuRoot;

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSubmenu,
  ContextMenuSubmenuTrigger,
  ContextMenuTrigger,
};
