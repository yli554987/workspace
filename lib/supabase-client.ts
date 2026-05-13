import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedKey = "";
let cachedClient: SupabaseClient | null = null;

export function normalizeSupabaseUrl(url: string) {
  const parsed = new URL(url.trim());
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  return parsed.origin;
}

export function getBrowserSupabase(url: string, anonKey: string) {
  const normalizedUrl = (() => {
    try {
      return normalizeSupabaseUrl(url);
    } catch {
      return null;
    }
  })();
  if (!normalizedUrl || !anonKey) return null;

  const key = `${normalizedUrl}|${anonKey}`;
  if (cachedClient && cachedKey === key) return cachedClient;

  try {
    cachedKey = key;
    cachedClient = createClient(normalizedUrl, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "personal-ai-workbench.supabase-auth"
      }
    });
  } catch {
    cachedKey = "";
    cachedClient = null;
  }

  return cachedClient;
}
