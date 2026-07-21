export function literalPathspec(file: string): string {
  return `:(literal)${file}`
}

export function literalPathspecs(files: readonly string[]): string[] {
  return files.map(literalPathspec)
}

export function isValidPathArg(file: string): boolean {
  return file.length > 0 && !file.includes('\0')
}
