/** Keep a dedicated system message with the newest durable notes. */
import type { Msg } from "./types";

export const MEMORY_HEADER = "Durable notes the user asked you to remember";

export function upsertMemoryMessage(messages: Msg[], block: string): void {
  const idx = messages.findIndex(
    (m) => m.role === "system" && m.content.startsWith(MEMORY_HEADER)
  );
  if (!block.trim()) {
    if (idx >= 0) messages.splice(idx, 1);
    return;
  }
  const msg: Msg = {
    role: "system",
    content: `${MEMORY_HEADER} (newest first):\n${block}`,
  };
  if (idx >= 0) {
    messages[idx] = msg;
    return;
  }
  const sys = messages.findIndex((m) => m.role === "system");
  messages.splice(sys >= 0 ? sys + 1 : 0, 0, msg);
}
