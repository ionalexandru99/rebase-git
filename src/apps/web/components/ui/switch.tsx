import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import type { ComponentProps } from "react";
import { cn } from "#web/lib/utils";

function Switch({
  className,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-input p-0.5 outline-none transition-colors data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 rounded-full bg-white transition-transform data-checked:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
