import type {
  ApiErrorPayload,
  ProfileResponse,
  QuestCreateRequest,
  QuestHintResponse,
  QuestResponse,
  QuestVerificationResponse,
  QuestVerifyRequest,
} from "@/types/api";

export const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";
const USER_STORAGE_KEY = "waybound_explorer_user_id";

export function getActiveUserId(): string {
  if (typeof window === "undefined") return DEFAULT_USER_ID;
  return localStorage.getItem(USER_STORAGE_KEY) || DEFAULT_USER_ID;
}

export function setActiveUserId(userId: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(USER_STORAGE_KEY, userId.trim());
  }
}

const QUEST_STORAGE_KEY = "waybound_active_quest_id";

export function getSavedActiveQuestId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(QUEST_STORAGE_KEY);
}

export function setSavedActiveQuestId(questId: string | null): void {
  if (typeof window !== "undefined") {
    if (questId) {
      localStorage.setItem(QUEST_STORAGE_KEY, questId.trim());
    } else {
      localStorage.removeItem(QUEST_STORAGE_KEY);
    }
  }
}

export class ApiError extends Error {
  status: number;
  data?: ApiErrorPayload;

  constructor(message: string, status: number, data?: ApiErrorPayload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

function getApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  // Remove trailing slashes
  return url.replace(/\/+$/, "");
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retries = 1
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${path}`;

  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  let attempt = 0;
  while (attempt <= retries) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errMessage = `HTTP error ${response.status}`;
        let parsedData: ApiErrorPayload | undefined;

        try {
          parsedData = await response.json();
          if (typeof parsedData?.detail === "string") {
            errMessage = parsedData.detail;
          } else if (Array.isArray(parsedData?.detail)) {
            errMessage = parsedData.detail
              .map((d) => (d.msg ? `${d.loc?.join(".") || "field"}: ${d.msg}` : JSON.stringify(d)))
              .join("; ");
          } else if (parsedData?.message) {
            errMessage = parsedData.message;
          }
        } catch {
          // If JSON parse fails, fallback to status text
          errMessage = response.statusText || errMessage;
        }

        throw new ApiError(errMessage, response.status, parsedData);
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      const isNetworkError =
        err instanceof TypeError ||
        (err instanceof Error && err.name === "AbortError");
      const is5xx = err instanceof ApiError && err.status >= 500;

      if ((isNetworkError || is5xx) && attempt < retries) {
        attempt++;
        await new Promise((res) => setTimeout(res, 500 * attempt));
        continue;
      }

      if (err instanceof ApiError) {
        throw err;
      }

      if (err instanceof Error && err.name === "AbortError") {
        throw new ApiError(
          "Request timed out. Please check if the WAYBOUND backend server is responding.",
          408
        );
      }

      throw new ApiError(
        (err as Error)?.message || "Failed to communicate with WAYBOUND backend server.",
        0
      );
    }
  }

  throw new ApiError("Maximum retry attempts reached", 0);
}

export const api = {
  /**
   * Health check
   */
  async getHealth(): Promise<{ status: string }> {
    return request<{ status: string }>("/health", { method: "GET" }, 0);
  },

  /**
   * Explorer Profile
   * GET /api/v1/users/{user_id}/profile
   */
  async getProfile(userId: string): Promise<ProfileResponse> {
    return request<ProfileResponse>(`/api/v1/users/${encodeURIComponent(userId)}/profile`);
  },

  /**
   * Quest History
   * GET /api/v1/users/{user_id}/quests
   */
  async getUserQuests(userId: string): Promise<QuestResponse[]> {
    return request<QuestResponse[]>(`/api/v1/users/${encodeURIComponent(userId)}/quests`);
  },

  /**
   * Quest Generation
   * POST /api/v1/quests/generate
   */
  async generateQuest(payload: QuestCreateRequest): Promise<QuestResponse> {
    return request<QuestResponse>("/api/v1/quests/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /**
   * Start Quest
   * POST /api/v1/quests/{quest_id}/start
   */
  async startQuest(questId: string): Promise<QuestResponse> {
    return request<QuestResponse>(`/api/v1/quests/${encodeURIComponent(questId)}/start`, {
      method: "POST",
    });
  },

  /**
   * Get Quest State
   * GET /api/v1/quests/{quest_id}
   */
  async getQuest(questId: string): Promise<QuestResponse> {
    return request<QuestResponse>(`/api/v1/quests/${encodeURIComponent(questId)}`);
  },

  /**
   * Unlock Next Clue
   * POST /api/v1/quests/{quest_id}/hint
   */
  async unlockHint(questId: string): Promise<QuestHintResponse> {
    return request<QuestHintResponse>(`/api/v1/quests/${encodeURIComponent(questId)}/hint`, {
      method: "POST",
    });
  },

  /**
   * Verify Completion
   * POST /api/v1/quests/{quest_id}/verify
   */
  async verifyQuest(
    questId: string,
    payload: QuestVerifyRequest
  ): Promise<QuestVerificationResponse> {
    return request<QuestVerificationResponse>(
      `/api/v1/quests/${encodeURIComponent(questId)}/verify`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },

  /**
   * Abandon Quest
   * POST /api/v1/quests/{quest_id}/abandon
   */
  async abandonQuest(questId: string): Promise<QuestResponse> {
    return request<QuestResponse>(`/api/v1/quests/${encodeURIComponent(questId)}/abandon`, {
      method: "POST",
    });
  },
};
