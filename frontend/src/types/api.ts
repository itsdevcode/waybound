export type ExplorerType = "discovery" | "nature" | "fitness" | "mystery" | "social";
export type DifficultyType = "easy" | "medium" | "hard";
export type AvailableMinutesType = 15 | 30 | 60;
export type QuestStatusType = "draft" | "active" | "completed" | "abandoned";

export interface QuestStepResponse {
  id: string;
  step_order: number;
  clue: string;
  is_unlocked: boolean;
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
