import type { ChatMessage, ChatSession } from "@/lib/types";

const SESSIONS_KEY = "french-study-buddy.local-sessions";
const messagesKey = (sessionId: string) => `french-study-buddy.local-messages.${sessionId}`;

export function loadLocalSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(SESSIONS_KEY);
    return raw ? (JSON.parse(raw) as ChatSession[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalSession(session: ChatSession) {
  if (typeof window === "undefined") return;
  const sessions = loadLocalSessions();
  const next = [
    { ...session, storage: "local" as const },
    ...sessions.filter((item) => item.id !== session.id)
  ].slice(0, 20);
  window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(next));
}

export function loadLocalMessages(sessionId: string): ChatMessage[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(messagesKey(sessionId));
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalMessages(sessionId: string, messages: ChatMessage[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(messagesKey(sessionId), JSON.stringify(messages));
}
