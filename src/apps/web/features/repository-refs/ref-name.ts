export function isValidRefName(name: string) {
  if (name === "HEAD" || name === "@" || name.startsWith("-")) return false;
  if ([...name].some(isControlOrSpace)) return false;
  if (/[~^:?*[\\]|\.\.|@\{|\/\/|^\/|\/$|\.$/.test(name)) return false;
  return name
    .split("/")
    .every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
}

function isControlOrSpace(character: string) {
  const code = character.charCodeAt(0);
  return code <= 0x20 || code === 0x7f;
}
