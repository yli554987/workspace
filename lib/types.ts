export type LanguageLevel = "Beginner A1" | "Elementary A2" | "Intermediate B1" | "Upper B2";

export type ChatMode = "Daily Conversation" | "Roleplay" | "Grammar Coach" | "Vocabulary Builder";

export type StoredSettings = {
  deepSeekApiKey: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export type UserMemory = {
  id?: string;
  memory_type: "preference" | "language_level" | "weakness" | "personal_fact" | "style";
  content: string;
  confidence?: number;
  source_message_id?: string | null;
};

export type VocabCard = {
  term: string;
  chinese: string;
  example_fr: string;
  example_en?: string;
  notes_zh?: string;
};

export type GrammarCard = {
  title: string;
  explanation_zh: string;
  pattern?: string;
  example_fr: string;
  example_en?: string;
};

export type Correction = {
  original: string;
  better: string;
  explanation_zh: string;
};

export type StructuredAssistantResponse = {
  english: string;
  french: string;
  correction?: Correction | null;
  vocabulary_cards: VocabCard[];
  grammar_cards: GrammarCard[];
  memories_to_save: UserMemory[];
  next_topic_suggestions: string[];
  tone_note?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  structured_json?: StructuredAssistantResponse | null;
  created_at: string;
};

export type ChatSession = {
  id: string;
  user_id?: string | null;
  topic: string;
  mode: ChatMode | string;
  level: LanguageLevel | string;
  created_at: string;
  storage?: "local" | "supabase";
};
