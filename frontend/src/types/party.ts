import type { AvailableMinutesType, DifficultyType, ExplorerType } from "./api";

export interface SessionResponse {
  token: string;
  user_id: string;
  user_name: string;
  explorer_type: string;
  level: number;
  xp: number;
  expires_at: string;
}

export interface AuthMeResponse {
  user_id: string;
  user_name: string;
  email: string;
  explorer_type: string;
  level: number;
  xp: number;
}

export interface PartyMemberPublicResponse {
  user_id: string;
  slot_number: number;
  role: "host" | "member";
  status: string;
  display_name: string;
  is_real_name_revealed: boolean;
  joined_at: string;
  has_verified: boolean;
  reward_xp_awarded: number;
}

export interface PartyResponse {
  id: string;
  name: string;
  status: "open" | "active" | "completed" | "disbanded";
  host_id: string;
  created_at: string;
  members: PartyMemberPublicResponse[];
  invite_token?: string | null;
  invite_expires_at?: string | null;
  has_active_quest: boolean;
  party_quest_id?: string | null;
}

export interface PartyCreateRequest {
  name?: string;
  nickname: string;
}

export interface PartyJoinRequest {
  invite_token: string;
  nickname: string;
}

export interface ConsentRevealRequest {
  consent: boolean;
}

export interface PartyStartQuestRequest {
  available_minutes?: AvailableMinutesType;
  explorer_type?: ExplorerType;
  difficulty?: DifficultyType;
  latitude?: number | null;
  longitude?: number | null;
}

export interface SplitClueResponse {
  id: string;
  step_order: number;
  clue_title: string;
  clue_text: string;
  is_revealed: boolean;
  is_assigned_to_me: boolean;
}

export interface SharedPartyQuestResponse {
  party_id: string;
  party_quest_id: string;
  quest_id: string;
  title: string;
  description: string;
  difficulty: string;
  estimated_minutes: number;
  reward_xp: number;
  status: "active" | "completed" | "abandoned";
  my_slot: number;
  my_clues: SplitClueResponse[];
  partner_clues_count: number;
  partner_clues_revealed: number;
  partner_display_name: string;
  partner_verified: boolean;
  my_verified: boolean;
  verification_prompt: string | null;
  destination_name: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface PartyVerifyRequest {
  latitude: number;
  longitude: number;
  observation_answer: string;
}

export interface PartyVerificationResponse {
  success: boolean;
  message: string;
  my_verified: boolean;
  partner_verified: boolean;
  quest_completed: boolean;
  reward_xp_awarded: number;
  total_xp: number;
  level: number;
  destination_name: string | null;
}
