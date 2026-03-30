export interface LapMetadata {
  id: string;
  user_id: string;
  track_id: string;
  car_id: string;
  lap_number: number;
  lap_time_ms: number;
  s1_ms: number | null;
  s2_ms: number | null;
  s3_ms: number | null;
  is_valid: boolean;
  sample_rate_hz: number;
  recorded_at: string;
  telemetry_url: string | null;
  // joined
  track_name?: string;
  car_name?: string;
  car_class?: string;
  username?: string;
}

export interface TelemetrySample {
  t: number;      // elapsed time (seconds)
  x: number;      // world position X
  y: number;      // world position Y
  z: number;      // world position Z
  speed: number;  // km/h
  gear: number;
  rpm: number;
  throttle: number; // 0–1
  brake: number;    // 0–1
  steering: number; // -1 to 1
  clutch: number;   // 0–1
}

export interface Track {
  id: string;
  name: string;
  length_m: number;
  map_path: string | null;
}

export interface SessionResult {
  id: string;
  ingame_name: string;
  car_type: string;
  car_class: string;
  car_number: string;
  team_name: string;
  grid_pos: number | null;
  finish_pos: number;
  class_pos: number;
  laps_completed: number;
  best_lap_ms: number | null;
  pitstops: number;
  finish_status: string;
  laps: SessionLap[];
}

export interface SessionLap {
  num: number;
  lap_time_ms: number | null;
  s1_ms: number | null;
  s2_ms: number | null;
  s3_ms: number | null;
  top_speed_kph: number;
  tyre_compound: string;
  is_pit_lap: boolean;
  race_position: number | null;
}

export interface Session {
  id: string;
  track_id: string;
  session_type: string;
  event_name: string;
  started_at: string;
  duration_min: number;
  track?: Track;
  results?: SessionResult[];
}

export interface CommunityStats {
  total_laps: number;
  total_drivers: number;
  total_km: number;
}

export interface TrackRecord {
  lap_id: string;
  track_id: string;
  track_name: string;
  car_name: string;
  car_class: string;
  lap_time_ms: number;
  username: string | null;
  recorded_at: string;
}

export interface UserResult {
  finish_pos: number;
  class_pos: number;
  best_lap_ms: number | null;
  laps_completed: number;
  finish_status: string;
  car_name: string;
  car_class: string;
}

export interface UserSession extends Session {
  my_result: UserResult;
  car_classes: string[];
}

// Lap comparison data returned by GET /api/compare
export interface CompareData {
  lap_a: LapMetadata;
  lap_b: LapMetadata;
  samples_a: TelemetrySample[];
  samples_b: TelemetrySample[];
}

export function formatLapTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(3).padStart(6, "0");
  return `${minutes}:${seconds}`;
}

export function formatDelta(ms: number): string {
  const sign = ms >= 0 ? "+" : "-";
  return `${sign}${(Math.abs(ms) / 1000).toFixed(3)}`;
}
