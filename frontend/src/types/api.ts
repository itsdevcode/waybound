export type ExplorerType = "discovery" | "nature" | "fitness" | "mystery" | "social";
export type DifficultyType = "easy" | "medium" | "hard";
export type AvailableMinutesType = 15 | 30 | 60;
export type QuestStatusType = "draft" | "active" | "completed" | "abandoned";

export interface QuestStepResponse {
  id: string;
  step_order: number;
  clue: string;
  is_unlocked: boolean;
  latitude?: number | null;
  longitude?: number | null;
  waypoint_name?: string | null;
}

export interface QuestResponse {
  id: string;
  title: string;
  description: string;
  difficulty: DifficultyType | string;
  estimated_minutes: number;
  reward_xp: number;
  status: QuestStatusType | string;
  current_clues: QuestStepResponse[];
  verification_prompt: string | null;
  destination_name: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface QuestCreateRequest {
  user_id: string;
  available_minutes: AvailableMinutesType;
  explorer_type: ExplorerType;
  difficulty: DifficultyType;
  latitude?: number | null;
  longitude?: number | null;
}

export interface QuestVerifyRequest {
  latitude: number;
  longitude: number;
  observation_answer: string;
  is_manual_location?: boolean;
}

export interface QuestVerificationResponse {
  success: boolean;
  message: string;
  reward_xp_awarded: number;
  total_xp: number;
  level: number;
  quest: QuestResponse;
}

export interface QuestHintResponse {
  unlocked_step: QuestStepResponse | null;
  all_hints_unlocked: boolean;
  quest: QuestResponse;
}

export interface ProfileResponse {
  id: string;
  user_id: string;
  explorer_type: string;
  level: number;
  xp: number;
  social_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserResponse {
  id: string;
  name: string;
  email: string;
  created_at: string;
  updated_at: string;
  profile?: ProfileResponse | null;
}

export interface ApiErrorPayload {
  detail?: string | Array<{ loc?: string[]; msg?: string }>;
  message?: string;
}

export interface NarrationConfigResponse {
  enabled: boolean;
  default_voice_id: string | null;
  default_model_id: string | null;
}

export interface NarrationSynthesizeParams {
  quest_id: string;
  content_type: "story" | "clue" | "completion";
  step_id?: string;
  voice_id?: string;
  model_id?: string;
}

export type QuestMarkerStatus = "available" | "active" | "completed" | "locked";

export interface NearbyQuestItem {
  id: string | null;
  title: string;
  description: string;
  difficulty: DifficultyType | string;
  estimated_minutes: number;
  reward_xp: number;
  status: QuestMarkerStatus;
  latitude: number;
  longitude: number;
  distance_meters: number;
  verification_radius_meters: number;
  is_active: boolean;
  is_simulated?: boolean;
  is_destination_secret?: boolean;
}

export interface NearbyQuestsResponse {
  items: NearbyQuestItem[];
  center_latitude: number;
  center_longitude: number;
  radius_meters: number;
  total_count: number;
}

export interface NearbyCityItem {
  name: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
  place_id?: string | null;
  distance_km?: number | null;
}
