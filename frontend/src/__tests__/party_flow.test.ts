import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, getAuthToken, setAuthToken, removeAuthToken } from "@/lib/api";
import type { PartyResponse, SharedPartyQuestResponse, PartyVerificationResponse } from "@/types/party";

describe("Social Mystery Partner Frontend Flows", () => {
  beforeEach(() => {
    localStorage.clear();
    removeAuthToken();
    vi.restoreAllMocks();
  });

  describe("Authentication & Bearer Token Management", () => {
    it("stores and retrieves auth token from localStorage", () => {
      expect(getAuthToken()).toBeNull();
      setAuthToken("opaque_session_token_123");
      expect(getAuthToken()).toBe("opaque_session_token_123");
      expect(localStorage.getItem("waybound_session_token")).toBe("opaque_session_token_123");

      removeAuthToken();
      expect(getAuthToken()).toBeNull();
      expect(localStorage.getItem("waybound_session_token")).toBeNull();
    });

    it("attaches Authorization header when auth token exists", async () => {
      setAuthToken("secret_bearer_token_xyz");

      const mockParty: PartyResponse = {
        id: "party-1",
        name: "Fellowship of Shadows",
        status: "open",
        host_id: "user-1",
        invite_token: null,
        members: [],
        has_active_quest: false,
        created_at: new Date().toISOString(),
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockParty,
      });
      globalThis.fetch = mockFetch;

      await api.parties.get("party-1");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1].headers;
      const authHeader =
        headers instanceof Headers
          ? headers.get("Authorization")
          : (headers as Record<string, string>)?.Authorization ||
            (headers as Record<string, string>)?.authorization;
      expect(authHeader).toBe("Bearer secret_bearer_token_xyz");
    });

    it("handles email OTP request and verification flow", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            message: "Code sent",
            email: "seeker@waybound.dev",
            expires_in_seconds: 600,
            simulated_code: "123456",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: "wbs_token_verified_otp",
            user_id: "user-otp-1",
            user_name: "Seeker",
            explorer_type: "mystery",
            level: 1,
            xp: 0,
            expires_at: new Date().toISOString(),
          }),
        });

      const otpReq = await api.auth.requestOtp("seeker@waybound.dev");
      expect(otpReq.email).toBe("seeker@waybound.dev");
      expect(otpReq.simulated_code).toBe("123456");

      const session = await api.auth.verifyOtp("seeker@waybound.dev", "123456");
      expect(session.token).toBe("wbs_token_verified_otp");
      expect(getAuthToken()).toBe("wbs_token_verified_otp");
    });

    it("logs out and revokes active token", async () => {
      setAuthToken("token_to_revoke");
      expect(getAuthToken()).toBe("token_to_revoke");

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, message: "Revoked" }),
      });

      await api.auth.logout();
      expect(getAuthToken()).toBeNull();
    });
  });

  describe("Party API Lifecycle", () => {
    it("creates a party and receives opaque invite token", async () => {
      setAuthToken("token_alpha");

      const mockParty: PartyResponse = {
        id: "party-abc",
        name: "Order of the Key",
        status: "open",
        host_id: "user-alpha",
        invite_token: "wb_inv_alpha998877",
        members: [
          {
            user_id: "user-alpha",
            display_name: "Seeker",
            slot_number: 1,
            role: "host",
            status: "active",
            is_real_name_revealed: false,
            joined_at: new Date().toISOString(),
            has_verified: false,
            reward_xp_awarded: 0,
          },
        ],
        has_active_quest: false,
        created_at: new Date().toISOString(),
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockParty,
      });

      const result = await api.parties.create({
        name: "Order of the Key",
        nickname: "Seeker",
      });

      expect(result.id).toBe("party-abc");
      expect(result.invite_token).toBe("wb_inv_alpha998877");
      expect(result.members).toHaveLength(1);
      expect(result.members[0].display_name).toBe("Seeker");
    });

    it("joins a party using an opaque invite token", async () => {
      setAuthToken("token_beta");

      const mockParty: PartyResponse = {
        id: "party-abc",
        name: "Order of the Key",
        status: "active",
        host_id: "user-alpha",
        invite_token: null,
        members: [
          {
            user_id: "user-alpha",
            display_name: "Seeker",
            slot_number: 1,
            role: "host",
            status: "active",
            is_real_name_revealed: false,
            joined_at: new Date().toISOString(),
            has_verified: false,
            reward_xp_awarded: 0,
          },
          {
            user_id: "user-beta",
            display_name: "Scholar",
            slot_number: 2,
            role: "member",
            status: "active",
            is_real_name_revealed: false,
            joined_at: new Date().toISOString(),
            has_verified: false,
            reward_xp_awarded: 0,
          },
        ],
        has_active_quest: false,
        created_at: new Date().toISOString(),
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockParty,
      });
      globalThis.fetch = fetchMock;

      const result = await api.parties.join({
        invite_token: "wb_inv_alpha998877",
        nickname: "Scholar",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/parties/join"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            invite_token: "wb_inv_alpha998877",
            nickname: "Scholar",
          }),
        })
      );
      expect(result.members).toHaveLength(2);
      expect(result.status).toBe("active");
    });

    it("toggles identity-reveal consent", async () => {
      setAuthToken("token_alpha");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "party-abc",
          name: "Order of the Key",
          status: "active",
          host_id: "user-alpha",
          invite_token: null,
          members: [
            {
              user_id: "user-alpha",
              display_name: "Seeker",
              slot_number: 1,
              role: "host",
              status: "active",
              is_real_name_revealed: true,
              joined_at: new Date().toISOString(),
              has_verified: false,
              reward_xp_awarded: 0,
            },
          ],
          has_active_quest: false,
          created_at: new Date().toISOString(),
        }),
      });
      globalThis.fetch = fetchMock;

      const updated = await api.parties.setConsent("party-abc", true);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/parties/party-abc/consent"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ consent: true }),
        })
      );
      expect(updated.members[0].is_real_name_revealed).toBe(true);
    });
  });

  describe("Split Clue Privacy & Cooperative Verification", () => {
    it("ensures quest response contains only the authenticated explorer's split clues", async () => {
      setAuthToken("token_alpha");

      const mockQuestResponse: SharedPartyQuestResponse = {
        quest_id: "quest-coop-99",
        party_id: "party-abc",
        party_quest_id: "pq-123",
        title: "The Whispering Archives",
        description: "Two fragments of an ancient cipher are needed to awaken the sanctuary.",
        status: "active",
        difficulty: "medium",
        estimated_minutes: 30,
        reward_xp: 75,
        my_slot: 1,
        partner_display_name: "Scholar",
        my_clues: [
          {
            id: "clue-1",
            step_order: 1,
            clue_title: "Fragment I",
            clue_text: "Look for the granite keystone inscribed with roman numerals.",
            is_revealed: true,
            is_assigned_to_me: true,
          },
          {
            id: "clue-2",
            step_order: 2,
            clue_title: "Fragment II",
            clue_text: "Beside the bronze fountain, count the three weeping fig trees.",
            is_revealed: false,
            is_assigned_to_me: true,
          },
        ],
        partner_clues_count: 2,
        partner_clues_revealed: 1,
        partner_verified: false,
        my_verified: false,
        verification_prompt: "Enter the year carved into the base stone",
        destination_name: null, // shielded until both verify
        created_at: new Date().toISOString(),
        completed_at: null,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockQuestResponse,
      });

      const quest = await api.parties.getSharedQuest("party-abc");

      // Verify that my_clues only contain assigned clues
      expect(quest.my_clues.every((c) => c.is_assigned_to_me)).toBe(true);
      // Destination name is shielded before completion
      expect(quest.destination_name).toBeNull();
      // Partner clue text is never included, only count
      expect((quest as unknown as Record<string, unknown>)["partner_clues"]).toBeUndefined();
      expect(quest.partner_clues_count).toBe(2);
      expect(quest.partner_clues_revealed).toBe(1);
    });

    it("submits individual verification with GPS coordinates securely", async () => {
      setAuthToken("token_alpha");

      const mockVerificationResult: PartyVerificationResponse = {
        success: true,
        message: "Arrival and observation verified! Both explorers succeeded.",
        my_verified: true,
        partner_verified: true,
        quest_completed: true,
        reward_xp_awarded: 75,
        total_xp: 325,
        level: 2,
        destination_name: "San Francisco Public Library",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockVerificationResult,
      });
      globalThis.fetch = fetchMock;

      const result = await api.parties.verifyArrival("party-abc", {
        latitude: 37.7792,
        longitude: -122.4161,
        observation_answer: "1878",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/parties/party-abc/quest/verify"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            latitude: 37.7792,
            longitude: -122.4161,
            observation_answer: "1878",
          }),
        })
      );

      // Once verified and completed, destination is revealed
      expect(result.quest_completed).toBe(true);
      expect(result.destination_name).toBe("San Francisco Public Library");
      expect(result.reward_xp_awarded).toBe(75);
    });
  });
});
