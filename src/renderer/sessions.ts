/** Sidebar of persisted conversations. */
import type { SessionMeta, SessionView } from "../shared/types.js";
import { hydrateFeed } from "./chat.js";
import { showToast } from "./toast.js";

const sidebar = document.getElementById("session-sidebar") as HTMLElement;
const listEl = document.getElementById("session-list") as HTMLElement;
const toggleBtn = document.getElementById("toggle-sessions") as HTMLButtonElement;
const showBtn = document.getElementById("show-sessions") as HTMLButtonElement;

let currentId = "";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function renderSessionList(sessions: SessionMeta[], activeId: string): void {
  currentId = activeId;
  listEl.replaceChildren();
  if (sessions.length === 0) {
    const empty = document.createElement("li");
    empty.className = "session-empty";
    empty.textContent = "No sessions yet.";
    listEl.append(empty);
    return;
  }
  for (const s of sessions) {
    const li = document.createElement("li");
    li.className = "session-item" + (s.id === activeId ? " active" : "");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "session-open";
    btn.title = s.title;
    const title = document.createElement("span");
    title.className = "session-title";
    title.textContent = s.title;
    const when = document.createElement("span");
    when.className = "session-when";
    when.textContent = formatWhen(s.updatedAt);
    btn.append(title, when);
    btn.addEventListener("click", () => {
      void loadSession(s.id);
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "ghost-btn icon-btn session-del";
    del.title = "Delete session";
    del.textContent = "×";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      void deleteSession(s.id);
    });
    li.append(btn, del);
    listEl.append(li);
  }
}

export async function applySession(view: SessionView, sessions?: SessionMeta[]): Promise<void> {
  hydrateFeed(view.messages);
  const list = sessions ?? (await window.jarvis.listSessions());
  renderSessionList(list, view.id);
}

async function loadSession(id: string): Promise<void> {
  if (id === currentId) return;
  const view = await window.jarvis.loadSession(id);
  await applySession(view);
  showToast("Session restored", "info");
}

async function deleteSession(id: string): Promise<void> {
  const { sessions, current } = await window.jarvis.deleteSession(id);
  await applySession(current, sessions);
  showToast("Session deleted", "info");
}

export function setSidebarOpen(open: boolean): void {
  sidebar.classList.toggle("collapsed", !open);
  showBtn.hidden = open;
}

export function initSessions(): void {
  toggleBtn.addEventListener("click", () => setSidebarOpen(false));
  showBtn.addEventListener("click", () => setSidebarOpen(true));
}

export function currentSessionId(): string {
  return currentId;
}
