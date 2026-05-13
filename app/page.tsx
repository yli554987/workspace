"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  Home,
  KeyRound,
  Loader2,
  MessageCircle,
  Plus,
  Volume2,
  Send,
  Settings,
  Sparkles,
  Star,
  Wrench
} from "lucide-react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { callDeepSeekChat } from "@/lib/deepseek-client";
import { emptySettings, loadDraftSettings, loadSettings, saveDraftSettings, saveSettings } from "@/lib/local-settings";
import { getBrowserSupabase, normalizeSupabaseUrl } from "@/lib/supabase-client";
import type { ChatMessage, ChatMode, ChatSession, LanguageLevel, StoredSettings, StructuredAssistantResponse, UserMemory } from "@/lib/types";
import { cn } from "@/lib/utils";

const tools = [
  { id: "home", label: "Workbench Home", icon: Home },
  { id: "french", label: "French Study Buddy", icon: MessageCircle },
  { id: "settings", label: "API & Data Settings", icon: Settings }
] as const;

const topics = ["At the cafe", "Travel check-in", "Directions", "Weekend plans", "Shopping", "Tiny small talk"];
const modes: ChatMode[] = ["Daily Conversation", "Roleplay", "Grammar Coach", "Vocabulary Builder"];
const levels: LanguageLevel[] = ["Beginner A1", "Elementary A2", "Intermediate B1", "Upper B2"];

const starterStructured: StructuredAssistantResponse = {
  english: "Bonjour! Choose a topic and send a message. I will coach you in English, give French examples, and explain cards in Chinese.",
  french: "Bonjour ! Choisis un sujet et envoie un message. Je vais t'aider en anglais avec des exemples français.",
  correction: null,
  vocabulary_cards: [
    {
      term: "bonjour",
      chinese: "你好 / 早上好",
      example_fr: "Bonjour, je voudrais un café.",
      example_en: "Hello, I would like a coffee.",
      notes_zh: "白天见面常用，比 salut 更礼貌。"
    }
  ],
  grammar_cards: [
    {
      title: "Je voudrais...",
      explanation_zh: "用于礼貌表达请求，中文可理解为“我想要……”。",
      pattern: "Je voudrais + nom / infinitif",
      example_fr: "Je voudrais un café.",
      example_en: "I would like a coffee."
    }
  ],
  memories_to_save: [],
  next_topic_suggestions: topics.slice(0, 3)
};

const initialAssistant: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: `${starterStructured.english}\n\n${starterStructured.french}`,
  structured_json: starterStructured,
  created_at: ""
};

function makeId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function maskKey(value: string) {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}

function validateSupabaseBrowserKey(key: string) {
  const value = key.trim();
  if (!value) return "Supabase anon/public key is required.";
  if (value.startsWith("sb_secret_") || value.startsWith("sb_service_")) {
    return "Use the Supabase anon/public key, not a secret or service-role key.";
  }

  const [, payload] = value.split(".");
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
    if (decoded.role && decoded.role !== "anon") return `This key role is "${decoded.role}". Use anon/public.`;
  } catch {
    return null;
  }

  return null;
}

function formatMessageTime(value: string, hydrated: boolean) {
  if (!hydrated || !value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function speakText(text: string, lang: "fr-FR" | "en-US") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = lang === "fr-FR" ? 0.88 : 0.95;
  window.speechSynthesis.speak(utterance);
}

export default function WorkbenchPage() {
  const [activeTool, setActiveTool] = useState<(typeof tools)[number]["id"]>("french");
  const [settings, setSettings] = useState<StoredSettings>(emptySettings);
  const [draftSettings, setDraftSettings] = useState<StoredSettings>(emptySettings);
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [setupHint, setSetupHint] = useState("");
  const [status, setStatus] = useState("Load saved browser settings or complete setup to begin.");
  const [syncStatus, setSyncStatus] = useState("Not synced yet.");
  const [savedCounts, setSavedCounts] = useState({ sessions: 0, messages: 0, memories: 0 });
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([initialAssistant]);
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [topic, setTopic] = useState(topics[0]);
  const [mode, setMode] = useState<ChatMode>("Daily Conversation");
  const [level, setLevel] = useState<LanguageLevel>("Beginner A1");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const ready = Boolean(settings.deepSeekApiKey && supabase && user);
  const latestAssistant = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant" && message.structured_json)?.structured_json || starterStructured,
    [messages]
  );

  useEffect(() => {
    setHydrated(true);
    const loaded = loadSettings();
    const draft = loadDraftSettings();
    setSettings(loaded);
    setDraftSettings(draft || loaded);
    setSupabase(getBrowserSupabase(loaded.supabaseUrl, loaded.supabaseAnonKey));

    if (window.location.hash.includes("error=")) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const code = params.get("error_code");
      const description = params.get("error_description") || params.get("error") || "Supabase login failed.";
      const message =
        code === "otp_expired"
          ? "Magic link expired or was already used. Send a fresh link and open the newest email in this same browser."
          : description;
      setSetupHint(message);
      setStatus(message);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    saveSettings(settings);
    setSupabase(getBrowserSupabase(settings.supabaseUrl, settings.supabaseAnonKey));
  }, [settings]);

  useEffect(() => {
    saveDraftSettings(draftSettings);
  }, [draftSettings]);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      if (error) {
        setSetupHint(error.message);
        setStatus(`Supabase session error: ${error.message}`);
        return;
      }
      setUser(data.session?.user ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, authSession) => {
      setUser(authSession?.user ?? null);
      if (authSession?.user) {
        setSetupHint("");
        setStatus("Supabase login restored. Workbench is ready.");
      }
    });

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !user) return;
    void loadRemoteState();
  }, [supabase, user]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function requireReady(action: string) {
    if (!settings.deepSeekApiKey || !settings.supabaseUrl || !settings.supabaseAnonKey || !supabase) {
      const hint = "Complete DeepSeek key, Supabase URL, and Supabase anon/public key in the left setup panel.";
      setSetupHint(hint);
      setStatus(`${action} needs setup first.`);
      setActiveTool("settings");
      return false;
    }
    if (!user) {
      const hint = "Enter your Supabase email and finish magic-link login before using tools.";
      setSetupHint(hint);
      setStatus(`${action} needs Supabase login first.`);
      setActiveTool("settings");
      return false;
    }
    setSetupHint("");
    return true;
  }

  function confirmSettings() {
    const next = {
      deepSeekApiKey: draftSettings.deepSeekApiKey.trim(),
      supabaseUrl: draftSettings.supabaseUrl.trim(),
      supabaseAnonKey: draftSettings.supabaseAnonKey.trim()
    };
    if (!next.deepSeekApiKey || !next.supabaseUrl || !next.supabaseAnonKey) {
      setSetupHint("All fields are required.");
      setStatus("Complete all API fields before confirming.");
      return;
    }
    try {
      const normalizedUrl = normalizeSupabaseUrl(next.supabaseUrl);
      if (!normalizedUrl) throw new Error("Invalid Supabase URL.");
      next.supabaseUrl = normalizedUrl;
    } catch {
      setSetupHint("Supabase URL should look like https://xxxx.supabase.co");
      setStatus("Supabase URL is invalid.");
      return;
    }
    const keyError = validateSupabaseBrowserKey(next.supabaseAnonKey);
    if (keyError) {
      setSetupHint(keyError);
      setStatus("Wrong Supabase key type.");
      return;
    }
    setSettings(next);
    setDraftSettings(next);
    setShowKeys(false);
    setSetupHint("Settings saved in this browser. Now send a Supabase magic link.");
    setStatus("API settings saved locally.");
  }

  async function signIn() {
    if (!settings.deepSeekApiKey || !settings.supabaseUrl || !settings.supabaseAnonKey || !supabase) {
      setSetupHint("Confirm API settings before email login.");
      setStatus("Setup is incomplete.");
      return;
    }
    if (!email.trim()) {
      setSetupHint("Enter your email first.");
      setStatus("Email is required.");
      return;
    }
    setBusy(true);
    try {
      const authUrl = `${normalizeSupabaseUrl(settings.supabaseUrl)}/auth/v1/otp?redirect_to=${encodeURIComponent(
        window.location.origin
      )}`;
      const response = await fetch(authUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: settings.supabaseAnonKey,
          Authorization: `Bearer ${settings.supabaseAnonKey}`
        },
        body: JSON.stringify({
          email: email.trim(),
          create_user: true,
          gotrue_meta_security: {}
        })
      });

      if (!response.ok) {
        const detail = await response.text();
        let message = detail || response.statusText;
        try {
          const parsed = JSON.parse(detail) as { msg?: string; message?: string; error_description?: string };
          message = parsed.msg || parsed.message || parsed.error_description || message;
        } catch {
          // Keep raw detail when Supabase returns plain text.
        }
        setSetupHint(message);
        setStatus(`Login failed: ${message}`);
        return;
      }

      setSetupHint("Check the newest magic-link email. It can be used once.");
      setStatus("Magic link sent.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Supabase request failed.";
      setSetupHint(
        `Supabase login request failed. Confirm the URL is exactly ${settings.supabaseUrl || "https://xxxx.supabase.co"}, the key is anon/public, and your Supabase project is active. Details: ${message}`
      );
      setStatus("Could not reach Supabase Auth.");
    } finally {
      setBusy(false);
    }
  }

  async function loadRemoteState() {
    if (!supabase || !user) return;
    const [{ data: sessionRows, error: sessionError }, { data: memoryRows, error: memoryError }] = await Promise.all([
      supabase.from("chat_sessions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(12),
      supabase.from("user_memories").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(12)
    ]);
    if (sessionError || memoryError) {
      setSyncStatus(sessionError?.message || memoryError?.message || "Supabase load failed.");
      return;
    }
    const remoteSessions = ((sessionRows as ChatSession[]) || []).map((item) => ({ ...item, storage: "supabase" as const }));
    setSessions(remoteSessions);
    setMemories((memoryRows as UserMemory[]) || []);
    if (!session && remoteSessions[0]) await openSession(remoteSessions[0]);
  }

  async function createSupabaseSession(nextTopic = topic) {
    if (!supabase || !user) return null;
    const remoteSession: ChatSession = {
      id: makeId(),
      user_id: user.id,
      topic: nextTopic,
      mode,
      level,
      created_at: new Date().toISOString(),
      storage: "supabase"
    };
    const { error } = await supabase.from("chat_sessions").insert({
      id: remoteSession.id,
      user_id: user.id,
      topic: nextTopic,
      mode,
      level,
      created_at: remoteSession.created_at
    });
    if (error) {
      setStatus(`Could not create session: ${error.message}`);
      setSyncStatus(error.message);
      return null;
    }
    setSession(remoteSession);
    setSessions((current) => [remoteSession, ...current.filter((item) => item.id !== remoteSession.id)]);
    setSavedCounts((current) => ({ ...current, sessions: current.sessions + 1 }));
    return remoteSession;
  }

  async function persistMessage(message: ChatMessage, activeSession: ChatSession) {
    if (!supabase || !user) return null;
    const { error } = await supabase.from("messages").insert({
      id: message.id,
      session_id: activeSession.id,
      user_id: user.id,
      role: message.role,
      content: message.content,
      structured_json: message.structured_json || null,
      created_at: message.created_at
    });
    if (error) {
      setSyncStatus(`Message save failed: ${error.message}`);
      setStatus(`Supabase save failed: ${error.message}`);
      return null;
    }
    setSavedCounts((current) => ({ ...current, messages: current.messages + 1 }));
    setSyncStatus(`Saved ${message.role} message.`);
    return message;
  }

  async function saveMemories(items: UserMemory[], sourceMessageId?: string) {
    if (!items.length || !supabase || !user) return;
    const rows = items.map((item) => ({
      id: makeId(),
      user_id: user.id,
      memory_type: item.memory_type,
      content: item.content,
      confidence: item.confidence ?? 0.8,
      source_message_id: sourceMessageId || null
    }));
    const { error } = await supabase.from("user_memories").insert(rows);
    if (error) {
      setSyncStatus(`Memory save failed: ${error.message}`);
      return;
    }
    setMemories((current) => [...(rows as UserMemory[]), ...current].slice(0, 12));
    setSavedCounts((current) => ({ ...current, memories: current.memories + rows.length }));
  }

  async function sendMessage(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    if (!requireReady("Chat")) return;

    setBusy(true);
    const activeSession = session?.storage === "supabase" ? session : await createSupabaseSession(topic);
    if (!activeSession) {
      setBusy(false);
      return;
    }

    const previousMessages = messages.filter((message) => message.id !== "welcome");
    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: text,
      created_at: new Date().toISOString()
    };
    setInput("");
    setMessages((current) => [...current, userMessage]);

    const savedUser = await persistMessage(userMessage, activeSession);
    if (!savedUser) {
      setBusy(false);
      return;
    }

    try {
      const structured = await callDeepSeekChat({
        apiKey: settings.deepSeekApiKey,
        topic,
        mode,
        level,
        memories,
        messages: [...previousMessages, userMessage]
      });
      const assistantMessage: ChatMessage = {
        id: makeId(),
        role: "assistant",
        content: `${structured.english}\n\n${structured.french}`,
        structured_json: structured,
        created_at: new Date().toISOString()
      };
      setMessages((current) => [...current, assistantMessage]);
      const savedAssistant = await persistMessage(assistantMessage, activeSession);
      await saveMemories(structured.memories_to_save, savedUser.id || savedAssistant?.id);
      setStatus(savedAssistant ? "Reply and cards saved to Supabase." : "Reply generated, but assistant save failed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "DeepSeek call failed.");
    } finally {
      setBusy(false);
    }
  }

  async function newSession() {
    if (!requireReady("New session")) return;
    setMessages([initialAssistant]);
    await createSupabaseSession(topic);
  }

  async function openSession(item: ChatSession) {
    if (!supabase || !user) return;
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("session_id", item.id)
      .order("created_at", { ascending: true });
    if (error) {
      setStatus(`Could not open session: ${error.message}`);
      return;
    }
    setSession(item);
    setTopic(item.topic || topics[0]);
    setMode((item.mode as ChatMode) || "Daily Conversation");
    setLevel((item.level as LanguageLevel) || "Beginner A1");
    setMessages(data?.length ? (data as ChatMessage[]) : [initialAssistant]);
    setActiveTool("french");
  }

  return (
    <main className="h-screen overflow-hidden p-4 text-stone-900 md:p-6">
      <div className="mx-auto grid h-full max-w-[1500px] gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="h-full overflow-y-auto rounded-lg border bg-white/78 p-5 shadow-panel backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-md bg-orange-500 text-white">
              <Wrench className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-orange-600">Personal Workbench</h1>
              <p className="text-xs text-stone-600">Local keys · Supabase data · GitHub Pages ready</p>
            </div>
          </div>

          <nav className="mt-6 space-y-2 border-y py-5">
            {tools.map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={() => (tool.id === "settings" || tool.id === "home" ? setActiveTool(tool.id) : requireReady(tool.label) && setActiveTool(tool.id))}
                className={cn(
                  "flex h-12 w-full items-center gap-3 rounded-md px-4 text-left font-semibold transition",
                  activeTool === tool.id ? "bg-orange-100 text-orange-700" : "hover:bg-orange-50"
                )}
              >
                <tool.icon className="h-5 w-5" />
                {tool.label}
              </button>
            ))}
          </nav>

          <Card className="mt-5 bg-white/84">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-5 w-5 text-orange-500" />
                Shared API & Data
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {setupHint && <div className="rounded-md border bg-orange-50 p-3 text-xs font-semibold leading-5 text-orange-700">{setupHint}</div>}
              <div className="relative">
                <Input
                  type={showKeys ? "text" : "password"}
                  placeholder="DeepSeek API key"
                  value={draftSettings.deepSeekApiKey}
                  onChange={(event) => setDraftSettings({ ...draftSettings, deepSeekApiKey: event.target.value })}
                  className="pr-10"
                />
                <button type="button" className="absolute right-3 top-2.5 text-stone-500" onClick={() => setShowKeys((value) => !value)} aria-label="Toggle key visibility">
                  {showKeys ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <Input
                type={showKeys ? "url" : "password"}
                placeholder="Supabase URL"
                value={draftSettings.supabaseUrl}
                onChange={(event) => setDraftSettings({ ...draftSettings, supabaseUrl: event.target.value })}
              />
              <Input
                type={showKeys ? "text" : "password"}
                placeholder="Supabase anon/public key"
                value={draftSettings.supabaseAnonKey}
                onChange={(event) => setDraftSettings({ ...draftSettings, supabaseAnonKey: event.target.value })}
              />
              <Button className="w-full" type="button" onClick={confirmSettings}>
                Confirm & Save Browser Settings
              </Button>
              <div className="border-t pt-3">
                <Input type="email" placeholder="Supabase email" value={email} onChange={(event) => setEmail(event.target.value)} />
                <Button className="mt-2 w-full" variant="secondary" type="button" onClick={signIn} disabled={busy}>
                  Send Magic Link
                </Button>
              </div>
              <Badge className={ready ? "border-green-200 bg-green-100 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}>
                {ready ? "Ready" : "Setup required"}
              </Badge>
              {settings.deepSeekApiKey && <p className="text-xs text-stone-500">Saved: {maskKey(settings.deepSeekApiKey)}</p>}
              <p className="text-xs leading-5 text-stone-500">Keys stay in this browser. Use Supabase anon/public key only.</p>
            </CardContent>
          </Card>
        </aside>

        <section className="h-full min-h-0 overflow-hidden rounded-lg border bg-white/78 shadow-panel backdrop-blur">
          {activeTool === "home" && (
            <div className="p-6">
              <h2 className="text-3xl font-black">My Tools</h2>
              <p className="mt-2 text-stone-600">A shared AI workbench where every tool uses the same browser API settings and Supabase account.</p>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <ToolCard title="French Study Buddy" description="French learning chat with Chinese grammar and vocabulary cards." onOpen={() => requireReady("French Study Buddy") && setActiveTool("french")} />
                <ToolCard title="API & Data Settings" description="Manage local API keys, Supabase login, and sync state." onOpen={() => setActiveTool("settings")} />
              </div>
            </div>
          )}

          {activeTool === "settings" && (
            <div className="grid gap-5 p-6 lg:grid-cols-2">
              <Card className="bg-white/86">
                <CardHeader>
                  <CardTitle>Connection State</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <StatusLine ok={Boolean(settings.deepSeekApiKey)} label="DeepSeek API key saved" />
                  <StatusLine ok={Boolean(settings.supabaseUrl && settings.supabaseAnonKey && supabase)} label="Supabase anon client ready" />
                  <StatusLine ok={Boolean(user)} label={user ? `Logged in: ${user.email || user.id}` : "Supabase email login"} />
                  <div className="rounded-md border bg-orange-50 p-3 text-xs leading-5 text-stone-700">
                    <p><span className="font-semibold">Sync:</span> {syncStatus}</p>
                    <p><span className="font-semibold">Saved:</span> {savedCounts.sessions} sessions · {savedCounts.messages} messages · {savedCounts.memories} memories</p>
                  </div>
                  {user && (
                    <Button variant="outline" onClick={() => supabase?.auth.signOut()}>
                      Sign out
                    </Button>
                  )}
                </CardContent>
              </Card>
              <Card className="bg-white/86">
                <CardHeader>
                  <CardTitle>GitHub Pages Notes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm leading-6 text-stone-600">
                  <p>This app is configured as a static export. It does not depend on a Next.js API route.</p>
                  <p>Supabase redirect URLs must include the final Pages URL and localhost during development.</p>
                  <p>DeepSeek is called from the browser because the key is intentionally local-only.</p>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTool === "french" && (
            <div className="grid h-full min-h-0 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="flex min-h-0 flex-col border-r">
                <header className="border-b p-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="flex items-center gap-3 text-2xl font-black">
                        <span className="grid h-10 w-10 place-items-center rounded-md border bg-white text-orange-500">
                          <MessageCircle className="h-6 w-6" />
                        </span>
                        French Study Buddy
                      </h2>
                      <p className="mt-1 text-sm text-stone-600">{status}</p>
                    </div>
                    <Button variant="outline" size="icon" onClick={() => void newSession()} aria-label="New session">
                      <Plus className="h-5 w-5" />
                    </Button>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <select className="h-10 rounded-md border bg-white/80 px-3 text-sm font-semibold" value={level} onChange={(event) => requireReady("Change level") && setLevel(event.target.value as LanguageLevel)}>
                      {levels.map((item) => <option key={item}>{item}</option>)}
                    </select>
                    <select className="h-10 rounded-md border bg-white/80 px-3 text-sm font-semibold" value={topic} onChange={(event) => requireReady("Change topic") && setTopic(event.target.value)}>
                      {topics.map((item) => <option key={item}>{item}</option>)}
                    </select>
                    <select className="h-10 rounded-md border bg-white/80 px-3 text-sm font-semibold" value={mode} onChange={(event) => requireReady("Change mode") && setMode(event.target.value as ChatMode)}>
                      {modes.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </div>
                </header>

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-gradient-to-b from-orange-50/35 to-white/30 p-5">
                  {messages.map((message) => (
                    <div key={message.id} className={cn("flex flex-col", message.role === "user" ? "items-end" : "items-start")}>
                      <div
                        className={cn(
                          "max-w-[82%] rounded-lg border p-4 shadow-sm",
                          message.role === "user"
                            ? "border-orange-200 bg-orange-50 text-stone-900 shadow-glow"
                            : "border-stone-200 bg-white/94"
                        )}
                      >
                        {message.role === "assistant" && message.structured_json ? (
                          <AssistantBubble data={message.structured_json} />
                        ) : (
                          <p className="whitespace-pre-wrap text-base leading-7">{message.content}</p>
                        )}
                      </div>
                      <div className={cn("mt-1 text-xs text-stone-400", message.role === "user" ? "mr-1" : "ml-1")}>
                        {formatMessageTime(message.created_at, hydrated)}
                      </div>
                    </div>
                  ))}
                  {busy && <div className="flex items-center gap-3 text-sm font-semibold text-orange-600"><Loader2 className="h-4 w-4 animate-spin" /> Study Buddy is thinking...</div>}
                  <div ref={scrollRef} />
                </div>

                <form onSubmit={sendMessage} className="border-t p-5">
                  <div className="flex items-end gap-3 rounded-lg border bg-white p-3 shadow-sm">
                    <Textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Type in English or French..." className="min-h-12 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0" />
                    <Button type="submit" size="icon" disabled={busy} aria-label="Send message">
                      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                    </Button>
                  </div>
                </form>
              </div>

              <aside className="h-full min-h-0 space-y-5 overflow-y-auto p-5">
                <StudyCards latestAssistant={latestAssistant} memories={memories} />
                <Card className="bg-white/84">
                  <CardHeader><CardTitle>Saved Sessions</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {sessions.length ? sessions.map((item) => (
                      <button key={item.id} className={cn("flex min-h-11 w-full items-center justify-between gap-3 rounded-md border bg-white/75 px-3 py-2 text-left text-sm hover:bg-orange-50", session?.id === item.id && "border-orange-300 bg-orange-50")} onClick={() => void openSession(item)}>
                        <span><span className="block font-semibold">{item.topic}</span><span className="text-xs text-stone-500">Supabase · {new Date(item.created_at).toLocaleDateString()}</span></span>
                        <ChevronRight className="h-4 w-4 text-stone-400" />
                      </button>
                    )) : <p className="text-sm text-stone-500">No Supabase sessions yet.</p>}
                  </CardContent>
                </Card>
              </aside>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ToolCard({ title, description, onOpen }: { title: string; description: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="rounded-lg border bg-white/84 p-5 text-left shadow-panel hover:bg-orange-50">
      <h3 className="text-lg font-black">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
      <ChevronRight className="mt-4 h-5 w-5 text-orange-500" />
    </button>
  );
}

function StatusLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <CheckCircle2 className={cn("h-5 w-5", ok ? "text-green-600" : "text-stone-300")} />
      <span>{label}</span>
    </div>
  );
}

function StudyCards({ latestAssistant, memories }: { latestAssistant: StructuredAssistantResponse; memories: UserMemory[] }) {
  return (
    <>
      <Card className="bg-white/84">
        <CardHeader><CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-amber-500" /> Vocabulary Cards</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {latestAssistant.vocabulary_cards.map((card, index) => (
            <div key={`${card.term}-${index}`} className="rounded-lg border bg-orange-50/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-amber-400 text-sm font-black text-white">{index + 1}</span>
                  <div><h3 className="font-black">{card.term}</h3><p className="mt-1 text-sm text-stone-700">{card.chinese}</p></div>
                </div>
                <Star className="h-5 w-5 text-amber-400" />
              </div>
              <p className="mt-3 text-sm italic text-stone-700">{card.example_fr}</p>
              {card.notes_zh && <p className="mt-2 text-xs text-stone-500">{card.notes_zh}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="bg-white/84">
        <CardHeader><CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-orange-500" /> Grammar Cards</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {latestAssistant.grammar_cards.map((card) => (
            <div key={card.title} className="rounded-lg border bg-amber-50/80 p-4">
              <h3 className="font-black">{card.title}</h3>
              <p className="mt-2 text-sm leading-6 text-stone-700">{card.explanation_zh}</p>
              {card.pattern && <Badge className="mt-3">{card.pattern}</Badge>}
              <p className="mt-3 text-sm italic">{card.example_fr}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="bg-white/84">
        <CardHeader><CardTitle className="flex items-center gap-2"><Brain className="h-5 w-5 text-orange-500" /> Memory</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-stone-700">
            {(memories.length ? memories : [{ memory_type: "preference", content: "Memories will appear after Supabase saves them." } as UserMemory]).slice(0, 6).map((memory, index) => (
              <li key={`${memory.content}-${index}`} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-amber-500" /><span>{memory.content}</span></li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

function AssistantBubble({ data }: { data: StructuredAssistantResponse }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 leading-7">{data.french}</p>
          <AudioButton label="Play French audio" title="Play French" onClick={() => speakText(data.french, "fr-FR")} tone="green" />
        </div>
        <div className="flex items-start gap-3 border-l-2 border-stone-300 pl-4 text-stone-500">
          <p className="min-w-0 flex-1 leading-7">{data.english}</p>
          <AudioButton label="Play English audio" title="Play English" onClick={() => speakText(data.english, "en-US")} tone="stone" />
        </div>
      </div>
      {data.correction && (
        <div className="rounded-lg border bg-amber-50/70 p-4">
          <h3 className="mb-3 flex items-center gap-2 font-black text-orange-600"><Star className="h-5 w-5 fill-amber-400 text-amber-400" /> Correction</h3>
          <div className="grid gap-2 text-sm">
            <div className="grid gap-2 sm:grid-cols-[86px_1fr]"><Badge className="bg-red-50 text-red-700">Original</Badge><span>{data.correction.original}</span></div>
            <div className="grid gap-2 sm:grid-cols-[86px_1fr]"><Badge className="bg-green-100 text-green-700">Better</Badge><span>{data.correction.better}</span></div>
            <div className="grid gap-2 sm:grid-cols-[86px_1fr]"><Badge className="bg-amber-100 text-amber-700">解释</Badge><span>{data.correction.explanation_zh}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

function AudioButton({
  label,
  title,
  onClick,
  tone
}: {
  label: string;
  title: string;
  onClick: () => void;
  tone: "green" | "stone";
}) {
  return (
    <button
      type="button"
      className={cn(
        "mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-md border transition",
        tone === "green"
          ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
          : "border-stone-200 bg-stone-50 text-stone-500 hover:bg-stone-100"
      )}
      onClick={onClick}
      aria-label={label}
      title={title}
    >
      <Volume2 className="h-4 w-4" />
    </button>
  );
}
