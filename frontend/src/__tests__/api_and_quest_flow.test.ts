import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "@/lib/api";
import type {
  QuestCreateRequest,
  QuestResponse,
  QuestVerificationResponse,
  QuestHintResponse,
} from "@/types/api";

describe("API Client & Quest Progression Flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it("enforces destination secrecy before completion", async () => {
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
    // Verification that destination name is null and no coordinates exist in response
    expect(res.destination_name).toBeNull();
    expect((res as unknown as Record<string, unknown>).destination_latitude).toBeUndefined();
    expect((res as unknown as Record<string, unknown>).destination_longitude).toBeUndefined();
  });

  it("handles hint unlock sequentially", async () => {
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
