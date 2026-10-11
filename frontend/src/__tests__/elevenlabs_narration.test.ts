import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getSavedVoiceProvider,
  setSavedVoiceProvider,
  STORAGE_KEY_VOICE_PROVIDER,
} from "@/lib/speech";
import { speechController } from "@/lib/speechController";
import { api } from "@/lib/api";

interface MockAudioInstance {
  src: string;
  play: () => Promise<void>;
  pause: () => void;
  ended: boolean;
  onplay: (() => void) | null;
  onpause: (() => void) | null;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}

describe("ElevenLabs Voice Integration & Fail-Safe Fallback", () => {
  let mockAudioPlay: ReturnType<typeof vi.fn>;
  let mockAudioPause: ReturnType<typeof vi.fn>;
  let createdAudioInstances: MockAudioInstance[] = [];
  let originalAudio: typeof globalThis.Audio;
  let originalUtterance: typeof globalThis.SpeechSynthesisUtterance;

  beforeEach(() => {
    vi.restoreAllMocks();
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
    speechController.resetForTesting();
    createdAudioInstances = [];

    // Mock window.speechSynthesis
    window.speechSynthesis = {
      speak: vi.fn(),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getVoices: vi.fn().mockReturnValue([]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onvoiceschanged: null,
      paused: false,
      pending: false,
      speaking: false,
      dispatchEvent: vi.fn().mockReturnValue(true),
    } as unknown as SpeechSynthesis;

    originalUtterance = globalThis.SpeechSynthesisUtterance;
    class MockSpeechSynthesisUtterance {
      text: string;
      rate = 1;
      pitch = 1;
      volume = 1;
      voice: SpeechSynthesisVoice | null = null;
      lang = "en-US";
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onpause: (() => void) | null = null;
      onresume: (() => void) | null = null;
      onmark: null = null;
      onboundary: null = null;
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      dispatchEvent = vi.fn().mockReturnValue(true);
      constructor(text: string) {
        this.text = text;
      }
    }
    globalThis.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance as unknown as typeof SpeechSynthesisUtterance;

    // Mock URL.createObjectURL and URL.revokeObjectURL
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-audio-url");
    globalThis.URL.revokeObjectURL = vi.fn();

    // Mock HTMLAudioElement
    originalAudio = globalThis.Audio;
    mockAudioPlay = vi.fn().mockResolvedValue(undefined);
    mockAudioPause = vi.fn();

    class MockAudio {
      src: string;
      play: () => Promise<void>;
      pause: () => void;
      ended = false;
      onplay: (() => void) | null = null;
      onpause: (() => void) | null = null;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src?: string) {
        this.src = src || "";
        this.play = mockAudioPlay as unknown as () => Promise<void>;
        this.pause = mockAudioPause as unknown as () => void;
        createdAudioInstances.push(this);
      }
    }

    globalThis.Audio = MockAudio as unknown as typeof Audio;
  });

  afterEach(() => {
    globalThis.Audio = originalAudio;
    globalThis.SpeechSynthesisUtterance = originalUtterance;
  });

  it("persists voice provider preference to localStorage", () => {
    expect(getSavedVoiceProvider()).toBe("browser");

    setSavedVoiceProvider("elevenlabs");
    expect(localStorage.getItem(STORAGE_KEY_VOICE_PROVIDER)).toBe("elevenlabs");
    expect(getSavedVoiceProvider()).toBe("elevenlabs");

    setSavedVoiceProvider("off");
    expect(localStorage.getItem(STORAGE_KEY_VOICE_PROVIDER)).toBe("off");
    expect(getSavedVoiceProvider()).toBe("off");

    setSavedVoiceProvider("browser");
    expect(getSavedVoiceProvider()).toBe("browser");
  });

  it("does not play audio when provider is set to 'off'", () => {
    speechController.setProvider("off");
    speechController.play("track-1", "Ancient temple scroll", "owner-1");

    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
    expect(mockAudioPlay).not.toHaveBeenCalled();
    expect(speechController.getSnapshot().isPlaying).toBe(false);
  });

  it("fetches and plays audio via ElevenLabs when provider is 'elevenlabs'", async () => {
    speechController.setProvider("elevenlabs");

    const mockBlob = new Blob(["fake-mp3-bytes"], { type: "audio/mpeg" });
    const fetchBlobSpy = vi.spyOn(api.narration, "fetchAudioBlob").mockResolvedValue(mockBlob);

    speechController.play(
      "story-track",
      "Mysterious ruins await in the valley.",
      "owner-1",
      {
        questId: "11111111-1111-1111-1111-111111111111",
        contentType: "story",
      }
    );

    // Initial state indicates loading audio
    expect(speechController.getSnapshot().isLoadingAudio).toBe(true);
    expect(speechController.getSnapshot().activeProvider).toBe("elevenlabs");
    expect(fetchBlobSpy).toHaveBeenCalledWith({
      quest_id: "11111111-1111-1111-1111-111111111111",
      content_type: "story",
      step_id: undefined,
      voice_id: undefined,
      model_id: undefined,
    });

    // Flush promises
    await Promise.resolve();
    await Promise.resolve();

    expect(createdAudioInstances.length).toBe(1);
    const audio = createdAudioInstances[0];
    expect(audio.src).toBe("blob:mock-audio-url");
    expect(mockAudioPlay).toHaveBeenCalled();

    // Trigger onplay callback
    audio.onplay?.();
    const state = speechController.getSnapshot();
    expect(state.isPlaying).toBe(true);
    expect(state.isLoadingAudio).toBe(false);
    expect(state.activeTrackId).toBe("story-track");
  });

  it("automatically falls back to browser TTS when ElevenLabs API fails", async () => {
    speechController.setProvider("elevenlabs");

    vi.spyOn(api.narration, "fetchAudioBlob").mockRejectedValue(
      new Error("503 Service Unavailable: rate limit exceeded")
    );

    speechController.play(
      "clue-track",
      "Look behind the mossy gargoyle.",
      "owner-1",
      {
        questId: "11111111-1111-1111-1111-111111111111",
        contentType: "clue",
        stepId: "22222222-2222-2222-2222-222222222222",
      }
    );

    // Wait for rejection and fallback
    await Promise.resolve();
    await Promise.resolve();

    // Should have invoked browser Web Speech fallback without breaking gameplay
    expect(window.speechSynthesis.speak).toHaveBeenCalled();
  });

  it("cancels stale ElevenLabs audio if user stops or switches tracks before download completes", async () => {
    speechController.setProvider("elevenlabs");

    let resolveBlob: (blob: Blob) => void = () => {};
    const blobPromise = new Promise<Blob>((resolve) => {
      resolveBlob = resolve;
    });
    vi.spyOn(api.narration, "fetchAudioBlob").mockReturnValue(blobPromise);

    // Explorer starts track 1
    speechController.play("track-1", "First narrative scroll", "owner-1", {
      questId: "11111111-1111-1111-1111-111111111111",
      contentType: "story",
    });
    expect(speechController.getSnapshot().isLoadingAudio).toBe(true);

    // Explorer immediately clicks stop or switches away
    speechController.stop("owner-1");
    expect(speechController.getSnapshot().isLoadingAudio).toBe(false);

    // Now the slow network response resolves
    resolveBlob(new Blob(["bytes"]));
    await Promise.resolve();
    await Promise.resolve();

    // Audio should NOT be played because utterance was invalidated
    expect(mockAudioPlay).not.toHaveBeenCalled();
    expect(speechController.getSnapshot().isPlaying).toBe(false);
  });

  it("enforces single playback by stopping ElevenLabs when switching to Browser speech", async () => {
    speechController.setProvider("elevenlabs");
    vi.spyOn(api.narration, "fetchAudioBlob").mockResolvedValue(new Blob(["audio"]));

    speechController.play("track-el", "ElevenLabs speech", "owner-1", {
      questId: "quest-1",
      contentType: "story",
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(createdAudioInstances.length).toBe(1);

    // Now user switches to browser speech
    speechController.setProvider("browser");
    speechController.play("track-browser", "Browser speech", "owner-1");

    expect(mockAudioPause).toHaveBeenCalled();
    expect(window.speechSynthesis.speak).toHaveBeenCalled();
  });
});
