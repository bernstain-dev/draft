// Quote every cell. Prefix dangerous text (including whitespace/control-prefixed
// formulas) with an apostrophe. Keep Unicode and original ordinary text intact.
export function csvCell(value: string | number): string {
  const text = String(value);
  const safe = typeof value === 'string' && (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) ? "'" + text : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function csvText(header: string[], rows: (string | number)[][]) { return '\uFEFF' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n'); }
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const blob = new Blob([csvText(header, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}
