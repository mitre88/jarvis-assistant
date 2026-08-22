/**
 * Minimal, safe markdown rendering for model replies: fenced code blocks,
 * inline code, and bold. Input is HTML-escaped before any tag insertion.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
}

export function renderMarkdown(text: string): string {
  const parts = text.split(/```[^\n]*\n?/);
  return parts
    .map((part, i) =>
      i % 2 === 1
        ? `<pre>${escapeHtml(part.replace(/\n$/, ""))}</pre>`
        : renderInline(part)
    )
    .join("");
}
