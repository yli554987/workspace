import type { ChatMessage, StructuredAssistantResponse, UserMemory } from "@/lib/types";

type ChatRequest = {
  apiKey: string;
  messages: Pick<ChatMessage, "role" | "content" | "structured_json">[];
  topic: string;
  mode: string;
  level: string;
  memories: UserMemory[];
};

const fallbackResponse: StructuredAssistantResponse = {
  english: "I could not reach DeepSeek from the browser. Your message was saved, but the assistant reply needs a successful model call.",
  french: "Je n'ai pas pu joindre DeepSeek depuis le navigateur. Ton message a été enregistré, mais la réponse exige un appel modèle réussi.",
  correction: null,
  vocabulary_cards: [],
  grammar_cards: [],
  memories_to_save: [],
  next_topic_suggestions: ["At the cafe", "Directions", "Weekend plans"],
  tone_note: "model-call-failed"
};

function parseStructured(content: string): StructuredAssistantResponse {
  const parsed = JSON.parse(content) as Partial<StructuredAssistantResponse>;
  return {
    english: parsed.english || fallbackResponse.english,
    french: parsed.french || fallbackResponse.french,
    correction: parsed.correction ?? null,
    vocabulary_cards: Array.isArray(parsed.vocabulary_cards) ? parsed.vocabulary_cards.slice(0, 4) : [],
    grammar_cards: Array.isArray(parsed.grammar_cards) ? parsed.grammar_cards.slice(0, 3) : [],
    memories_to_save: Array.isArray(parsed.memories_to_save) ? parsed.memories_to_save.slice(0, 3) : [],
    next_topic_suggestions: Array.isArray(parsed.next_topic_suggestions)
      ? parsed.next_topic_suggestions.slice(0, 4)
      : fallbackResponse.next_topic_suggestions,
    tone_note: parsed.tone_note
  };
}

export async function callDeepSeekChat({
  apiKey,
  messages,
  topic,
  mode,
  level,
  memories
}: ChatRequest): Promise<StructuredAssistantResponse> {
  const memoryText = memories
    .map((memory) => `- ${memory.memory_type}: ${memory.content} (${memory.confidence ?? 0.8})`)
    .join("\n");

  const systemPrompt = `You are French Study Buddy, a warm AI tutor inside a personal AI workbench.

Rules:
- Learners can write English, French, or mixed text.
- Reply with one concise English coaching message and one natural French equivalent.
- Teach French through English.
- Explain vocabulary and grammar cards in simplified Chinese.
- Save only durable memories: preferences, level, weaknesses, personal facts, style.
- Return only valid JSON.

Session:
- Topic: ${topic}
- Mode: ${mode}
- Level: ${level}

Known memories:
${memoryText || "- No saved memories yet."}

JSON shape:
{
  "english": "string",
  "french": "string",
  "correction": null | {"original":"string","better":"string","explanation_zh":"string"},
  "vocabulary_cards": [{"term":"string","chinese":"string","example_fr":"string","example_en":"string","notes_zh":"string"}],
  "grammar_cards": [{"title":"string","explanation_zh":"string","pattern":"string","example_fr":"string","example_en":"string"}],
  "memories_to_save": [{"memory_type":"preference | language_level | weakness | personal_fact | style","content":"string","confidence":0.8}],
  "next_topic_suggestions": ["string"],
  "tone_note": "string"
}`;

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.slice(-10).map((message) => ({
          role: message.role,
          content:
            message.role === "assistant" && message.structured_json
              ? JSON.stringify(message.structured_json)
              : message.content
        }))
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DeepSeek request failed: ${detail || response.statusText}`);
  }

  const completion = await response.json();
  const content = completion?.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned an empty response.");

  return parseStructured(content);
}
