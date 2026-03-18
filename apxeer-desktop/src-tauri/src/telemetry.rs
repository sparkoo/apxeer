use crate::lmu_telemetry::{SharedMemoryObjectOut, SharedMemoryReader};
use flate2::{write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

// ── Types written to disk ─────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct TelemetrySample {
    pub t: f64,       // mElapsedTime (seconds into session)
    pub x: f64,       // world position X
    pub y: f64,       // world position Y
    pub z: f64,       // world position Z
    pub speed: f64,   // km/h (derived from mLocalVel magnitude)
    pub gear: i32,    // -1=R, 0=N, 1+=forward
    pub rpm: f64,
    pub throttle: f64, // 0.0–1.0 (unfiltered driver input)
    pub brake: f64,    // 0.0–1.0
    pub steering: f64, // -1.0–1.0
    pub clutch: f64,   // 0.0–1.0
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LapMetadata {
    pub lap_number: i32,
    pub lap_time_ms: u32,
    pub s1_ms: Option<u32>,
    pub s2_ms: Option<u32>,
    pub s3_ms: Option<u32>,
    pub car_name: String,
    pub car_class: String,
    pub track_name: String,
    /// Raw mSession value: 0=test, 1-5=practice, 6-9=qualifying, 10=warmup, 11+=race
    pub session_type: i32,
    pub is_valid: bool,
    pub recorded_at: String, // RFC 3339
    pub sample_rate_hz: u32,
}

#[derive(Serialize, Deserialize)]
pub struct RecordedLap {
    pub metadata: LapMetadata,
    pub samples: Vec<TelemetrySample>,
}

// ── Recorder state (shared with Tauri commands) ───────────────────────────────

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum RecorderStatus {
    /// LMU shared memory is not available (game not running).
    LmuNotRunning,
    /// LMU is running but the player is not currently on track.
    Connected,
    /// Player is on track and samples are being collected.
    Recording,
}

#[derive(Serialize, Clone)]
pub struct RecorderState {
    pub status: RecorderStatus,
    pub current_lap: i32,
    pub pending_laps: usize,
}

impl RecorderState {
    pub fn initial() -> Self {
        Self {
            status: RecorderStatus::LmuNotRunning,
            current_lap: -1,
            pending_laps: 0,
        }
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Spawn the recording loop as a background thread.
///
/// The loop writes completed laps as JSON files into `buffer_dir` and keeps
/// `state` updated so Tauri commands can reflect the current status in the UI.
pub fn start(buffer_dir: PathBuf, state: Arc<Mutex<RecorderState>>) {
    thread::spawn(move || {
        run_loop(&buffer_dir, &state);
    });
}

// ── Recording loop ────────────────────────────────────────────────────────────

fn run_loop(buffer_dir: &Path, state: &Arc<Mutex<RecorderState>>) {
    const POLL_INTERVAL: Duration = Duration::from_millis(50); // 20 Hz

    let mut reader: Option<SharedMemoryReader> = None;
    let mut current_lap: i32 = -1;
    let mut samples: Vec<TelemetrySample> = Vec::new();

    loop {
        thread::sleep(POLL_INTERVAL);

        // Try to connect (or reconnect) to LMU shared memory.
        if reader.is_none() {
            match SharedMemoryReader::open() {
                Ok(r) => {
                    eprintln!("[telemetry] Connected to LMU shared memory");
                    reader = Some(r);
                }
                Err(_) => {
                    set_state(state, RecorderStatus::LmuNotRunning, -1, count_pending(buffer_dir));
                    continue;
                }
            }
        }

        let data = match reader.as_ref().unwrap().read() {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[telemetry] Read error, disconnecting: {}", e);
                reader = None;
                set_state(state, RecorderStatus::LmuNotRunning, -1, count_pending(buffer_dir));
                current_lap = -1;
                samples.clear();
                continue;
            }
        };

        let telem = &data.telemetry;

        // Player not in a vehicle — idle state.
        if telem.player_has_vehicle == 0 {
            if current_lap != -1 {
                eprintln!(
                    "[telemetry] Player left vehicle, discarding {} buffered samples",
                    samples.len()
                );
                current_lap = -1;
                samples.clear();
            }
            set_state(state, RecorderStatus::Connected, -1, count_pending(buffer_dir));
            continue;
        }

        let idx = telem.player_vehicle_idx as usize;
        if idx >= telem.active_vehicles as usize {
            continue;
        }

        let info = &telem.telem_info[idx];
        let lap = info.mLapNumber;

        // Lap 0 or negative means the formation/out lap before timing starts.
        if lap <= 0 {
            set_state(state, RecorderStatus::Connected, -1, count_pending(buffer_dir));
            continue;
        }

        set_state(state, RecorderStatus::Recording, lap, count_pending(buffer_dir));

        if current_lap == -1 {
            // First tick after entering a car on a numbered lap.
            eprintln!("[telemetry] Started recording on lap {}", lap);
            current_lap = lap;
        } else if lap != current_lap {
            // Lap boundary: finalize the lap we just completed.
            eprintln!(
                "[telemetry] Lap {} complete ({} samples), finalizing",
                current_lap,
                samples.len()
            );
            if samples.len() > 10 {
                finalize_lap(&data, idx, current_lap, std::mem::take(&mut samples), buffer_dir);
            } else {
                eprintln!(
                    "[telemetry] Too few samples ({}), discarding lap {}",
                    samples.len(),
                    current_lap
                );
                samples.clear();
            }
            current_lap = lap;
        }

        // Compute speed from local velocity vector magnitude (m/s → km/h).
        let v = &info.mLocalVel;
        let speed = (v.x * v.x + v.y * v.y + v.z * v.z).sqrt() * 3.6;

        samples.push(TelemetrySample {
            t: info.mElapsedTime,
            x: info.mPos.x,
            y: info.mPos.y,
            z: info.mPos.z,
            speed,
            gear: info.mGear,
            rpm: info.mEngineRPM,
            throttle: info.mUnfilteredThrottle,
            brake: info.mUnfilteredBrake,
            steering: info.mUnfilteredSteering,
            clutch: info.mUnfilteredClutch,
        });
    }
}

fn finalize_lap(
    data: &SharedMemoryObjectOut,
    player_idx: usize,
    lap_number: i32,
    samples: Vec<TelemetrySample>,
    buffer_dir: &Path,
) {
    // Find the player's scoring entry to get lap/sector times and car class.
    let scoring = data
        .scoring
        .vehScoringInfo
        .iter()
        .find(|v| v.mIsPlayer != 0);

    let (lap_time_ms, s1_ms, s2_ms, s3_ms, car_class, is_valid) = match scoring {
        Some(sc) => {
            let lt = sc.mLastLapTime;
            let s1 = sc.mLastSector1;
            let s2 = sc.mLastSector2;
            let valid = lt > 0.0;

            let lt_ms = (lt * 1000.0) as u32;
            let s1_ms = if s1 > 0.0 { Some((s1 * 1000.0) as u32) } else { None };
            let s2_ms = if s2 > 0.0 { Some((s2 * 1000.0) as u32) } else { None };
            // mLastSector1 and mLastSector2 are individual sector times.
            // s3 is derived as the remainder.
            let s3_ms = match (s1_ms, s2_ms) {
                (Some(s1), Some(s2)) if lt_ms > s1 + s2 => Some(lt_ms - s1 - s2),
                _ => None,
            };
            (lt_ms, s1_ms, s2_ms, s3_ms, bytes_to_string(&sc.mVehicleClass), valid)
        }
        None => (0, None, None, None, String::new(), false),
    };

    let info = &data.telemetry.telem_info[player_idx];
    let car_name = bytes_to_string(&info.mVehicleName);
    let track_name = bytes_to_string(&data.scoring.scoringInfo.mTrackName);
    let session_type = data.scoring.scoringInfo.mSession;

    let now = time::OffsetDateTime::now_utc();
    let recorded_at = now
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string());

    // Build a filesystem-safe filename from the timestamp.
    let ts = recorded_at.replace([':', '.'], "-");
    let filename = format!("{}-lap-{}.json.gz", ts, lap_number);
    let path = buffer_dir.join(&filename);

    let recorded_lap = RecordedLap {
        metadata: LapMetadata {
            lap_number,
            lap_time_ms,
            s1_ms,
            s2_ms,
            s3_ms,
            car_name,
            car_class,
            track_name,
            session_type,
            is_valid,
            recorded_at,
            sample_rate_hz: 20,
        },
        samples,
    };

    let write_result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let file = std::fs::File::create(&path)?;
        let mut gz = GzEncoder::new(file, Compression::default());
        serde_json::to_writer(&mut gz, &recorded_lap)?;
        gz.finish()?;
        Ok(())
    })();

    match write_result {
        Ok(_) => eprintln!(
            "[telemetry] Saved lap {} → {} ({} samples, valid={})",
            lap_number,
            filename,
            recorded_lap.samples.len(),
            is_valid
        ),
        Err(e) => eprintln!("[telemetry] Failed to write {:?}: {}", path, e),
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn bytes_to_string(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}

fn set_state(
    state: &Arc<Mutex<RecorderState>>,
    status: RecorderStatus,
    current_lap: i32,
    pending_laps: usize,
) {
    if let Ok(mut s) = state.lock() {
        s.status = status;
        s.current_lap = current_lap;
        s.pending_laps = pending_laps;
    }
}

fn count_pending(buffer_dir: &Path) -> usize {
    std::fs::read_dir(buffer_dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.path()
                        .to_str()
                        .map(|s| s.ends_with(".json.gz"))
                        .unwrap_or(false)
                })
                .count()
        })
        .unwrap_or(0)
}
