/**
 * Lines of succession by name. A seat or member named `style-2`, `main-4` and so on stands for whoever
 * holds that line in assets/lines.json; any other name is returned as it is.
 *
 * Kept in a module of its own so that scripts which fork workers can import it without importing
 * another script's worker.
 */
import { readFileSync } from 'node:fs';

/** The league member behind a name: a line of succession stands for its holder. */
export function memberOf(name: string): string {
  if (!/^(style|main)-[234]$/.test(name)) return name;
  const lines = JSON.parse(readFileSync(new URL('../assets/lines.json', import.meta.url), 'utf8')) as { lines: Record<string, { holder: string }> };
  const holder = lines.lines[name]?.holder;
  if (!holder) throw new Error(`No holder recorded for ${name}.`);
  return holder;
}
