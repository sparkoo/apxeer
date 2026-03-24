import type { CompareData, CommunityStats, LapMetadata, Session, TrackRecord, UserSession } from "./types";
import { supabase } from "./supabase";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:54321/functions/v1";

async function authHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    return { Authorization: `Bearer ${session.access_token}` };
  }
  return {};
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

export const api = {
  laps: {
    list: (trackId?: string, userId?: string): Promise<LapMetadata[]> => {
      const params = new URLSearchParams();
      if (trackId) params.set("track_id", trackId);
      if (userId) params.set("user_id", userId);
      return get(`/api/laps?${params}`);
    },
    get: (id: string): Promise<LapMetadata> => get(`/api/laps/${id}`),
  },

  compare: (lapAId: string, lapBId: string): Promise<CompareData> =>
    get(`/api/compare?lap_a=${lapAId}&lap_b=${lapBId}`),

  stats: {
    get: (): Promise<CommunityStats> => get("/api/stats"),
  },

  tracks: {
    records: (): Promise<TrackRecord[]> => get("/api/tracks/records"),
  },

  sessions: {
    list: (): Promise<Session[]> => get("/api/sessions"),
    get: (id: string): Promise<Session> => get(`/api/sessions/${id}`),
  },

  users: {
    get: (id: string) => get(`/api/users/${id}`),
    laps: (id: string): Promise<LapMetadata[]> => get(`/api/users/${id}/laps`),
    sessions: (id: string): Promise<UserSession[]> => get(`/api/users/${id}/sessions`),
  },
};
