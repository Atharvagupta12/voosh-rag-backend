// Splits article paragraphs into overlapping passages sized for retrieval.

function splitLong(paragraph, maxChars) {
  if (paragraph.length <= maxChars) return [paragraph];
  const sentences = paragraph.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [paragraph];
  const parts = [];
  let current = "";
  for (const s of sentences) {
    if (current && (current + s).length > maxChars) {
      parts.push(current.trim());
      current = "";
    }
    // A single enormous "sentence" is hard-cut.
    if (s.length > maxChars) {
      for (let i = 0; i < s.length; i += maxChars) parts.push(s.slice(i, i + maxChars).trim());
      continue;
    }
    current += s;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Greedily packs paragraphs into chunks of up to `maxChars`. Each new chunk
 * starts with the last paragraph of the previous one (when short enough) so
 * facts that straddle a boundary are still retrievable.
 */
export function chunkParagraphs(paragraphs, { maxChars = 1100, overlapChars = 350 } = {}) {
  const units = paragraphs.flatMap((p) => splitLong(p.trim(), maxChars)).filter(Boolean);
  const chunks = [];
  let current = [];
  let length = 0;

  for (const unit of units) {
    if (current.length && length + unit.length + 1 > maxChars) {
      chunks.push(current.join("\n"));
      const last = current.at(-1);
      current = last.length <= overlapChars && last.length + unit.length + 1 <= maxChars ? [last] : [];
      length = current.reduce((n, p) => n + p.length + 1, 0);
    }
    current.push(unit);
    length += unit.length + 1;
  }
  if (current.length) chunks.push(current.join("\n"));
  return chunks;
}
