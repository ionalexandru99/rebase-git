import { IconArrowBarToUp } from "@tabler/icons-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";

export function ScrollTopButton({
  region,
  className,
}: {
  readonly region: RefObject<HTMLElement | null>;
  readonly className?: string;
}) {
  const scrolled = useRef(new Set<Element>());
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = region.current;
    if (element === null) return;
    const track = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.scrollTop > 0) scrolled.current.add(event.target);
      else scrolled.current.delete(event.target);
      setVisible(scrolledLists(scrolled.current).length > 0);
    };
    element.addEventListener("scroll", track, { capture: true, passive: true });
    return () =>
      element.removeEventListener("scroll", track, { capture: true });
  }, [region]);
  return (
    <Button
      aria-label="Scroll to top"
      className={cn(visible ? undefined : "invisible", className)}
      onClick={() => {
        for (const list of scrolledLists(scrolled.current)) list.scrollTop = 0;
      }}
      size="icon-xs"
      variant="ghost"
    >
      <IconArrowBarToUp />
    </Button>
  );
}

function scrolledLists(lists: Set<Element>) {
  for (const list of lists)
    if (!list.isConnected || list.scrollTop === 0) lists.delete(list);
  return [...lists];
}
