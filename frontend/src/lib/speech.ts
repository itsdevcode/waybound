/**
 * WAYBOUND - Voice Game Master Speech Service
 * 
 * Provides client-side speech synthesis helpers using the browser Web Speech API.
 * Free, zero-API-key, private, client-side only.
 */

export const STORAGE_KEY_VOICE_MUTED = "waybound_voice_muted";
export const STORAGE_KEY_VOICE_URI = "waybound_voice_uri";

/**
 * Check if the browser supports SpeechSynthesis and SpeechSynthesisUtterance.
 */
export function isSpeechSynthesisSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

/**
 * Retrieve saved mute preference from localStorage.
 * Defaults to false (unmuted, ready for user-triggered interaction).
 */
export function getSavedVoiceMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const saved = localStorage.getItem(STORAGE_KEY_VOICE_MUTED);
    return saved === "true";
  } catch {
    return false;
  }
}

/**
 * Save mute preference to localStorage.
 */
export function setSavedVoiceMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_VOICE_MUTED, muted ? "true" : "false");
  } catch {
    // Ignore storage errors (private browsing, quota, etc.)
  }
}

/**
 * Retrieve saved voice URI from localStorage.
 */
export function getSavedVoiceUri(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY_VOICE_URI);
  } catch {
    return null;
  }
}

/**
 * Save voice URI preference to localStorage.
 */
export function setSavedVoiceUri(uri: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_VOICE_URI, uri);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Clean narration text for spoken delivery:
 * - Strips Markdown bold/italics/backticks/headers
 * - Removes bullet points or formatting artifacts
 * - Trims extra whitespace
 */
export function cleanNarrationForSpeech(text: string): string {
  if (!text) return "";
  return text
    // Remove markdown headers (e.g. ### Header)
    .replace(/^#{1,6}\s+/gm, "")
    // Remove bold and italics (e.g. **bold**, *italic*, __bold__, _italic_)
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    // Remove inline code or backticks
    .replace(/`([^`]+)`/g, "$1")
    // Remove markdown list markers (e.g. - item, * item, 1. item)
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    // Remove markdown blockquotes (e.g. > Quote)
    .replace(/^\s*>\s+/gm, "")
    // Clean up multiple spaces and newlines into smooth speech pauses
    .replace(/\r?\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Select the best RPG Game Master voice from the available system voices.
 * Prefers natural English voices (Google, Samantha, Daniel, Natural, etc.).
 */
export function pickGameMasterVoice(
  voices: SpeechSynthesisVoice[],
  preferredUri?: string | null
): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;

  // 1. If user previously chose a specific voice and it exists, respect it
  if (preferredUri) {
    const found = voices.find((v) => v.voiceURI === preferredUri);
    if (found) return found;
  }

  // 2. Filter for English voices
  const enVoices = voices.filter(
    (v) => v.lang.startsWith("en-") || v.lang === "en" || v.lang.startsWith("en_")
  );
  const candidates = enVoices.length > 0 ? enVoices : voices;

  // 3. Search for preferred high quality or natural sounding voices
  const preferredNames = [
    "Google UK English Male",
    "Google UK English Female",
    "Google US English",
    "Daniel",
    "Samantha",
    "Karen",
    "Moira",
    "Arthur",
    "Natural",
  ];

  for (const name of preferredNames) {
    const match = candidates.find((v) =>
      v.name.toLowerCase().includes(name.toLowerCase())
    );
    if (match) return match;
  }

  // 4. Fallback to default voice or first English candidate
  const defaultVoice = candidates.find((v) => v.default);
  return defaultVoice || candidates[0] || null;
}
