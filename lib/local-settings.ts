import type { StoredSettings } from "@/lib/types";

const SETTINGS_KEY = "french-study-buddy.settings";
const DRAFT_SETTINGS_KEY = "french-study-buddy.settings-draft";

export const emptySettings: StoredSettings = {
  deepSeekApiKey: "",
  supabaseUrl: "",
  supabaseAnonKey: ""
};

export function loadSettings(): StoredSettings {
  if (typeof window === "undefined") return emptySettings;

  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...emptySettings, ...JSON.parse(raw) } : emptySettings;
  } catch {
    return emptySettings;
  }
}

export function saveSettings(settings: StoredSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadDraftSettings(): StoredSettings | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(DRAFT_SETTINGS_KEY);
    return raw ? { ...emptySettings, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

export function saveDraftSettings(settings: StoredSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DRAFT_SETTINGS_KEY, JSON.stringify(settings));
}
