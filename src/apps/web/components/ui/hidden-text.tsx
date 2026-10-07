import { useState } from "react";

export function HiddenText({
  value,
  showLabel,
  hideLabel,
  className = "font-mono text-[.625rem]",
}: {
  readonly value: string;
  readonly className?: string;
  readonly showLabel: string;
  readonly hideLabel: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <button
      aria-label={shown ? hideLabel : showLabel}
      aria-pressed={shown}
      className={`cursor-pointer rounded-control hover:text-foreground ${className} ${shown ? "text-foreground/90" : "blur-xs select-none"}`}
      onClick={() => setShown((current) => !current)}
      type="button"
    >
      {shown ? value : scrambled(value)}
    </button>
  );
}

function scrambled(value: string) {
  const letters = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(value, (character, index) =>
    "@.-_<> ".includes(character)
      ? character
      : letters[(character.charCodeAt(0) * 7 + index * 13) % letters.length],
  ).join("");
}
