import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  api,
  ApiError,
  getSavedActiveQuestId,
  setSavedActiveQuestId,
} from "@/lib/api";
import type {
  QuestCreateRequest,
  QuestResponse,
  QuestVerificationResponse,
  QuestHintResponse,
} from "@/types/api";

describe("API Client & Quest Progression Flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  it("submits exact QuestCreateRequest schema without inventing fields", async () => {
    const mockCreatedQuest: QuestResponse = {
      id: "quest-123",
      title: "The Mystery of the Sunken Rose",
      description: "A forgotten path winding through stone arches.",
      difficulty: "medium",
      estimated_minutes: 30,
      reward_xp: 200,
      status: "draft",
      current_clues: [],
      verification_prompt: null,
      destination_name: null,
      created_at: "2026-10-11T00:00:00Z",
      started_at: null,
      completed_at: null,
      updated_at: "2026-10-11T00:00:00Z",
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockCreatedQuest,
    } as Response);

    const payload: QuestCreateRequest = {
      user_id: "00000000-0000-0000-0000-000000000001",
      available_minutes: 30,
      explorer_type: "mystery",
      difficulty: "medium",
      latitude: 37.7749,
      longitude: -122.4194,
    };

    const res = await api.generateQuest(payload);
    expect(res.id).toBe("quest-123");
    expect(res.status).toBe("draft");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/quests/generate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
      })
    );
  });

  it("enforces destination secrecy for draft and active quests before completion", async () => {
    const activeQuest: QuestResponse = {
      id: "quest-123",
      title: "Shadows of the Citadel",
      description: "Follow the runic path.",
      difficulty: "hard",
      estimated_minutes: 60,
      reward_xp: 350,
      status: "active",
      current_clues: [
        { id: "c1", step_order: 1, clue: "Find the iron gates", is_unlocked: true },
      ],
      verification_prompt: "What word is stamped on the plaque?",
      destination_name: null, // Strictly null before completion
      created_at: "2026-10-11T00:00:00Z",
      started_at: "2026-10-11T00:05:00Z",
      completed_at: null,
      updated_at: "2026-10-11T00:05:00Z",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => activeQuest,
    } as Response);

    const res = await api.getQuest("quest-123");
    // Verification that destination name is null and no destination coordinates exist in response
    expect(res.destination_name).toBeNull();
    expect((res as unknown as Record<string, unknown>).destination_latitude).toBeUndefined();
    expect((res as unknown as Record<string, unknown>).destination_longitude).toBeUndefined();
  });

  it("handles hint unlock sequentially without leaking destination", async () => {
    const hintRes: QuestHintResponse = {
      unlocked_step: {
        id: "c2",
        step_order: 2,
        clue: "Look toward the cypress grove",
        is_unlocked: true,
      },
      all_hints_unlocked: false,
      quest: {
        id: "quest-123",
        title: "Shadows of the Citadel",
        description: "Follow the runic path.",
        difficulty: "hard",
        estimated_minutes: 60,
        reward_xp: 350,
        status: "active",
        current_clues: [
          { id: "c1", step_order: 1, clue: "Find the iron gates", is_unlocked: true },
          { id: "c2", step_order: 2, clue: "Look toward the cypress grove", is_unlocked: true },
        ],
        verification_prompt: "What word is stamped on the plaque?",
        destination_name: null,
        created_at: "2026-10-11T00:00:00Z",
        started_at: "2026-10-11T00:05:00Z",
        completed_at: null,
        updated_at: "2026-10-11T00:05:00Z",
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => hintRes,
    } as Response);

    const res = await api.unlockHint("quest-123");
    expect(res.unlocked_step?.step_order).toBe(2);
    expect(res.quest.current_clues).toHaveLength(2);
    expect(res.quest.destination_name).toBeNull();
  });

  it("handles verification failure with backend detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        detail: "Verification failed: Location is not within the target destination area.",
      }),
    } as Response);

    await expect(
      api.verifyQuest("quest-123", {
        latitude: 37.0,
        longitude: -122.0,
        observation_answer: "owl",
      })
    ).rejects.toThrowError(
      "Verification failed: Location is not within the target destination area."
    );
  });

  it("enforces real-world 0 XP safety upon completion without fabricating rewards", async () => {
    const realWorldCompletion: QuestVerificationResponse = {
      success: true,
      message:
        "Quest completed and destination unlocked! Notice: Real-world progression XP is withheld pending field-verified observation ground truth.",
      reward_xp_awarded: 0, // CRITICAL: 0 XP
      total_xp: 450,
      level: 1,
      quest: {
        id: "quest-123",
        title: "Buena Vista Vista Point",
        description: "Climb the hill.",
        difficulty: "medium",
        estimated_minutes: 30,
        reward_xp: 200,
        status: "completed",
        current_clues: [],
        verification_prompt: "What color is the plaque?",
        destination_name: "Buena Vista Park Peak", // Destination unlocked on completion
        created_at: "2026-10-11T00:00:00Z",
        started_at: "2026-10-11T00:05:00Z",
        completed_at: "2026-10-11T00:25:00Z",
        updated_at: "2026-10-11T00:25:00Z",
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => realWorldCompletion,
    } as Response);

    const res = await api.verifyQuest("quest-123", {
      latitude: 37.769,
      longitude: -122.446,
      observation_answer: "bronze",
    });

    expect(res.success).toBe(true);
    expect(res.reward_xp_awarded).toBe(0);
    expect(res.quest.destination_name).toBe("Buena Vista Park Peak");
    expect(res.level).toBe(1);
  });
});

describe("State Restoration & Error Differentiation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("persists active quest ID in storage and restores without mutating or restarting", async () => {
    setSavedActiveQuestId("quest-xyz");
    expect(getSavedActiveQuestId()).toBe("quest-xyz");

    const mockSavedQuest: QuestResponse = {
      id: "quest-xyz",
      title: "Preserved Active Quest",
      description: "Still active.",
      difficulty: "easy",
      estimated_minutes: 15,
      reward_xp: 100,
      status: "active",
      current_clues: [
        { id: "c1", step_order: 1, clue: "Existing unlocked clue", is_unlocked: true },
      ],
      verification_prompt: "Observation prompt",
      destination_name: null,
      created_at: "2026-10-11T00:00:00Z",
      started_at: "2026-10-11T00:01:00Z",
      completed_at: null,
      updated_at: "2026-10-11T00:01:00Z",
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockSavedQuest,
    } as Response);

    const restored = await api.getQuest("quest-xyz");
    expect(restored.id).toBe("quest-xyz");
    expect(restored.status).toBe("active");

    // Strictly ensure GET was used, never POST /start
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/quests/quest-xyz",
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    );
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("/start"),
      expect.anything()
    );
  });

  it("clears stored active quest ID when quest is completed or abandoned", () => {
    setSavedActiveQuestId("quest-xyz");
    expect(getSavedActiveQuestId()).toBe("quest-xyz");

    setSavedActiveQuestId(null);
    expect(getSavedActiveQuestId()).toBeNull();
  });

  it("distinguishes backend connection failures from 404 user not found", async () => {
    // 1. Connection failure (status 0 or network abort)
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(api.getProfile("user-test")).rejects.toThrowError(ApiError);

    // 2. 404 User not found
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "User not found" }),
    } as Response);

    try {
      await api.getProfile("00000000-0000-0000-0000-000000000002");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(404);
      expect((e as ApiError).message).toBe("User not found");
    }
  });

  it("correctly handles legitimately empty quest history without error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    const quests = await api.getUserQuests("user-test");
    expect(quests).toEqual([]);
  });
});
