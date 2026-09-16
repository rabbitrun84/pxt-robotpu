/**
 * Pull a human description out of a program's source.
 *
 * A trace outlives the session that produced it, so it should carry enough
 * context to explain itself months later. The natural place for that text is
 * the doc comment already at the top of the program — not a separate field
 * someone has to remember to update.
 */

// Lines md-extract.mjs prepends. They describe the extraction, not the program.
const GENERATED = /^\s*\/\/\s*(GENERATED from|Regenerate:|---- block)/;

export function describeSource(source, limit = 1200) {
  if (!source) return "";
  const text = source.replace(/^﻿/, "");

  // Preferred: a leading /** … */ or /* … */ block.
  const block = text.match(/^\s*\/\*\*?([\s\S]*?)\*\//);
  if (block) {
    const body = block[1]
      .split("\n")
      .map((l) => l.replace(/^\s*\*\s?/, "").trimEnd())
      .join("\n")
      .trim();
    if (body) return body.slice(0, limit);
  }

  // Otherwise: the run of leading // lines, skipping extractor boilerplate.
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) { if (out.length) break; else continue; }
    if (GENERATED.test(line)) continue;
    if (!line.startsWith("//")) break;
    out.push(line.replace(/^\/\/\s?/, ""));
  }
  return out.join("\n").trim().slice(0, limit);
}
