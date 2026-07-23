/** Parse file:line locations from stack traces and error log bodies. */

export type StackLocation = {
  file: string;
  line: number;
  column?: number;
  function?: string;
  raw: string;
};

const STACK_PATTERNS = [
  // Go: path/file.go:123
  /(?:^|\s)([\w./\\-]+\.(?:go|mod)):(\d+)(?::(\d+))?/gm,
  // JS/TS: at path/file.ts:123:45 or path/file.tsx:10
  /(?:at\s+)?([\w./\\@-]+\.(?:tsx?|jsx?|mjs|cjs)):(\d+)(?::(\d+))?/gi,
  // Python: File "path/file.py", line 123
  /File\s+"([^"]+\.py)",\s+line\s+(\d+)/gi,
  // Java: (File.java:42)
  /([\w./\\-]+\.java):(\d+)/gi,
  // Generic path:line
  /([\w./\\-]+\.(?:go|ts|tsx|js|py|java|rb|rs)):(\d+)/gi,
];

export function parseStackLocations(text: string): StackLocation[] {
  const found = new Map<string, StackLocation>();

  for (const pattern of STACK_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const file = match[1]?.replace(/\\/g, "/") ?? "";
      const line = Number.parseInt(match[2] ?? "", 10);
      const column = match[3] ? Number.parseInt(match[3], 10) : undefined;
      if (!file || !Number.isFinite(line) || line <= 0) continue;

      const key = `${file}:${line}`;
      if (!found.has(key)) {
        found.set(key, {
          file,
          line,
          column: Number.isFinite(column) ? column : undefined,
          raw: match[0].trim(),
        });
      }
    }
  }

  return [...found.values()];
}

export function pickBestStackLocation(locations: StackLocation[]): StackLocation | null {
  if (locations.length === 0) return null;

  const scored = locations.map((loc) => {
    let score = 0;
    const lower = loc.file.toLowerCase();
    if (lower.includes("node_modules") || lower.includes("vendor/")) score -= 10;
    if (lower.includes("/test") || lower.includes("_test.")) score -= 3;
    if (lower.includes("/internal/") || lower.includes("/src/")) score += 2;
    if (lower.endsWith(".go") || lower.endsWith(".ts") || lower.endsWith(".tsx")) score += 1;
    return { loc, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.loc ?? null;
}
