use crate::settings::Settings;
use crate::telemetry::LapMetadata;
use flate2::read::GzDecoder;
use serde::Deserialize;
use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

// ── Upload result ─────────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum UploadError {
    NotAuthenticated,
    Io(std::io::Error),
    Http(String),
    Parse(String),
}

impl std::fmt::Display for UploadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotAuthenticated => write!(f, "not authenticated"),
            Self::Io(e) => write!(f, "io: {}", e),
            Self::Http(e) => write!(f, "http: {}", e),
            Self::Parse(e) => write!(f, "parse: {}", e),
        }
    }
}

// ── Partial struct for reading metadata from a lap .json.gz ──────────────────

#[derive(Deserialize)]
struct LapFile {
    metadata: LapMetadata,
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Spawn the upload loop as a background thread.
///
/// When `auto_upload` is enabled, it uploads any pending files every 30 seconds.
/// Manual uploads are triggered via the `upload_now` Tauri command.
pub fn start(
    telemetry_buffer: PathBuf,
    results_buffer: PathBuf,
    settings: Arc<Mutex<Settings>>,
) {
    thread::spawn(move || {
        upload_loop(telemetry_buffer, results_buffer, settings);
    });
}

/// Upload all pending files immediately. Called from the Tauri command.
pub fn upload_all(
    telemetry_buffer: &Path,
    results_buffer: &Path,
    settings: &Settings,
) -> (usize, usize) {
    let laps = upload_pending_laps(telemetry_buffer, settings);
    let sessions = upload_pending_sessions(results_buffer, settings);
    (laps, sessions)
}

// ── Upload loop ───────────────────────────────────────────────────────────────

fn upload_loop(
    telemetry_buffer: PathBuf,
    results_buffer: PathBuf,
    settings: Arc<Mutex<Settings>>,
) {
    loop {
        thread::sleep(Duration::from_secs(30));

        let s = settings.lock().unwrap().clone();
        if s.auto_upload && s.is_authenticated() {
            upload_pending_laps(&telemetry_buffer, &s);
            upload_pending_sessions(&results_buffer, &s);
        }
    }
}

/// Upload all .json.gz lap files in the buffer. Returns count of successful uploads.
fn upload_pending_laps(buffer_dir: &Path, settings: &Settings) -> usize {
    let files = pending_files(buffer_dir);
    let mut ok = 0;
    for path in files {
        match upload_lap(&path, settings) {
            Ok(_) => {
                eprintln!("[upload] Lap {:?} uploaded", path.file_name().unwrap_or_default());
                let _ = std::fs::remove_file(&path);
                ok += 1;
            }
            Err(UploadError::NotAuthenticated) => break, // no point continuing
            Err(e) => eprintln!("[upload] Lap {:?} failed: {}", path.file_name().unwrap_or_default(), e),
        }
    }
    ok
}

/// Upload all .json.gz session result files. Returns count of successful uploads.
fn upload_pending_sessions(buffer_dir: &Path, settings: &Settings) -> usize {
    let files = pending_files(buffer_dir);
    let mut ok = 0;
    for path in files {
        match upload_session(&path, settings) {
            Ok(_) => {
                eprintln!("[upload] Session {:?} uploaded", path.file_name().unwrap_or_default());
                let _ = std::fs::remove_file(&path);
                ok += 1;
            }
            Err(UploadError::NotAuthenticated) => break,
            Err(e) => eprintln!("[upload] Session {:?} failed: {}", path.file_name().unwrap_or_default(), e),
        }
    }
    ok
}

// ── Per-file upload ───────────────────────────────────────────────────────────

fn upload_lap(path: &Path, settings: &Settings) -> Result<(), UploadError> {
    if !settings.is_authenticated() {
        return Err(UploadError::NotAuthenticated);
    }

    // Read the compressed file.
    let compressed = std::fs::read(path).map_err(UploadError::Io)?;

    // Decompress to extract metadata for the request header.
    let mut decoder = GzDecoder::new(compressed.as_slice());
    let mut json_bytes = Vec::new();
    decoder.read_to_end(&mut json_bytes).map_err(UploadError::Io)?;

    let lap_file: LapFile = serde_json::from_slice(&json_bytes)
        .map_err(|e| UploadError::Parse(e.to_string()))?;

    // Skip invalid laps — don't waste bandwidth uploading them.
    if !lap_file.metadata.is_valid {
        return Ok(());
    }

    let meta_json = serde_json::to_string(&lap_file.metadata)
        .map_err(|e| UploadError::Parse(e.to_string()))?;

    let url = format!("{}/api/laps", settings.api_url);
    let resp = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", settings.auth_token))
        .set("Content-Type", "application/gzip")
        .set("X-Lap-Metadata", &meta_json)
        .send_bytes(&compressed)
        .map_err(|e| UploadError::Http(e.to_string()))?;

    if resp.status() >= 300 {
        return Err(UploadError::Http(format!("status {}", resp.status())));
    }

    Ok(())
}

fn upload_session(path: &Path, settings: &Settings) -> Result<(), UploadError> {
    if !settings.is_authenticated() {
        return Err(UploadError::NotAuthenticated);
    }

    // Decompress and send as JSON.
    let compressed = std::fs::read(path).map_err(UploadError::Io)?;
    let mut decoder = GzDecoder::new(compressed.as_slice());
    let mut json_bytes = Vec::new();
    decoder.read_to_end(&mut json_bytes).map_err(UploadError::Io)?;

    let url = format!("{}/api/sessions", settings.api_url);
    let resp = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", settings.auth_token))
        .set("Content-Type", "application/json")
        .send_bytes(&json_bytes)
        .map_err(|e| UploadError::Http(e.to_string()))?;

    if resp.status() >= 300 {
        return Err(UploadError::Http(format!("status {}", resp.status())));
    }

    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn pending_files(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .map(|entries| {
            let mut files: Vec<PathBuf> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.to_str().map(|s| s.ends_with(".json.gz")).unwrap_or(false))
                .collect();
            files.sort(); // oldest first (filenames are timestamp-prefixed)
            files
        })
        .unwrap_or_default()
}
