mod lmu_telemetry;
mod results;
mod settings;
mod telemetry;
mod upload;

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

use settings::Settings;
use telemetry::{RecorderState, RecorderStatus};

// ── LMU path detection ────────────────────────────────────────────────────────

/// Tries to find the LMU results folder automatically.
/// Checks the Steam registry key first, then falls back to the Documents default.
fn detect_lmu_results_dir() -> PathBuf {
    const LMU_SUBPATH: &[&str] = &["UserData", "Log", "Results"];

    // 1. Steam registry: HKCU\SOFTWARE\Valve\Steam → SteamPath
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        if let Ok(steam_key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"SOFTWARE\Valve\Steam") {
            if let Ok(steam_path) = steam_key.get_value::<String, _>("SteamPath") {
                let candidate = LMU_SUBPATH.iter().fold(
                    PathBuf::from(steam_path)
                        .join("steamapps").join("common").join("Le Mans Ultimate"),
                    |p, seg| p.join(seg),
                );
                if candidate.exists() {
                    return candidate;
                }
            }
        }
    }

    // 2. Documents fallback
    dirs::document_dir()
        .map(|d| LMU_SUBPATH.iter().fold(
            d.join("Le Mans Ultimate"),
            |p, seg| p.join(seg),
        ))
        .unwrap_or_default()
}

// ── Auth constants ─────────────────────────────────────────────────────────────

// The local TCP port that catches the OAuth callback from the browser.
const OAUTH_CALLBACK_PORT: u16 = 54321;

// ── Auth helpers ───────────────────────────────────────────────────────────────

fn pkce_pair() -> (String, String) {
    let verifier: String = (0..64)
        .map(|_| {
            let r = rand::random::<u8>() % 62;
            if r < 10 { (b'0' + r) as char }
            else if r < 36 { (b'a' + r - 10) as char }
            else { (b'A' + r - 36) as char }
        })
        .collect();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

fn extract_code(request_line: &str) -> Option<String> {
    // "GET /?code=xxx&state=yyy HTTP/1.1"
    let path = request_line.split_whitespace().nth(1)?;
    let query = path.split('?').nth(1)?;
    query.split('&')
        .find(|p| p.starts_with("code="))
        .map(|p| p.trim_start_matches("code=").to_string())
}

/// Exchange the PKCE authorization code for a Clerk session token.
/// Uses Clerk's standard OAuth 2.0 token endpoint.
///
/// clerk_domain: your Clerk Frontend API domain, e.g. "your-app.clerk.accounts.dev"
/// client_id: your Clerk Publishable Key (used as OAuth client_id for native apps)
fn exchange_pkce(
    clerk_domain: &str,
    client_id: &str,
    code: &str,
    verifier: &str,
) -> Result<(String, String), String> {
    let token_url = format!("https://{}/v1/oauth_token", clerk_domain);
    let redirect_uri = format!("http://127.0.0.1:{}/", OAUTH_CALLBACK_PORT);

    let resp = ureq::post(&token_url)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_string(&format!(
            "grant_type=authorization_code&client_id={}&code={}&redirect_uri={}&code_verifier={}",
            client_id,
            urlencoding::encode(code),
            urlencoding::encode(&redirect_uri),
            verifier,
        ))
        .map_err(|e| e.to_string())?;

    let body: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;

    // Clerk returns the session token as access_token.
    // The email can be extracted from the JWT claims or fetched separately.
    let access_token = body["access_token"].as_str().unwrap_or("").to_string();
    if access_token.is_empty() {
        return Err(format!("No access_token in response: {}", body));
    }

    // Attempt to extract email from the id_token or user info if present.
    let email = body["id_token"].as_str()
        .and_then(|tok| {
            // Decode JWT payload (base64url middle segment) without verification.
            let parts: Vec<&str> = tok.split('.').collect();
            parts.get(1).and_then(|p| {
                base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(p).ok()
                    .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                    .and_then(|v| v["email"].as_str().map(|s| s.to_string()))
            })
        })
        .unwrap_or_default();

    Ok((access_token, email))
}

// ── Auth commands ──────────────────────────────────────────────────────────────

#[tauri::command]
fn login_oauth(
    settings: tauri::State<Arc<Mutex<Settings>>>,
    config_dir: tauri::State<ConfigDir>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let (verifier, challenge) = pkce_pair();

    let (clerk_domain, clerk_client_id) = {
        let s = settings.lock().unwrap();
        if s.clerk_domain.is_empty() {
            return Err("Clerk domain not configured. Set it in Settings.".to_string());
        }
        if s.clerk_publishable_key.is_empty() {
            return Err("Clerk publishable key not configured. Set it in Settings.".to_string());
        }
        // The Publishable Key is used as client_id for native PKCE flows.
        (s.clerk_domain.clone(), s.clerk_publishable_key.clone())
    };

    let settings_clone = settings.inner().clone();
    let config_dir_path = config_dir.0.clone();

    // Clone so these can be moved into the spawn closure while remaining
    // available after the spawn for building the auth_url.
    let clerk_domain_thread = clerk_domain.clone();
    let clerk_client_id_thread = clerk_client_id.clone();

    std::thread::spawn(move || {
        let listener = match TcpListener::bind(format!("127.0.0.1:{}", OAUTH_CALLBACK_PORT)) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[auth] Port {} unavailable: {}", OAUTH_CALLBACK_PORT, e);
                return;
            }
        };
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut reader = BufReader::new(&stream);
                let mut request_line = String::new();
                reader.read_line(&mut request_line).ok();

                // Drain remaining headers
                let mut line = String::new();
                while reader.read_line(&mut line).is_ok() {
                    if line == "\r\n" || line.is_empty() { break; }
                    line.clear();
                }

                // Respond to the browser
                let html = r#"<!DOCTYPE html><html><head><style>body{background:#111113;color:#e8e8ea;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:#1c1c1f;border:1px solid #2a2a2e;border-radius:12px;padding:40px;text-align:center}h1{color:#e8304a;font-size:1.1rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px}p{color:#8a8a92;font-size:.9rem}</style></head><body><div class="card"><h1>Apxeer</h1><p>Signed in! You can close this tab.</p></div></body></html>"#;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    html.len(), html
                );
                stream.write_all(response.as_bytes()).ok();
                drop(stream);

                if let Some(code) = extract_code(&request_line) {
                    match exchange_pkce(&clerk_domain_thread, &clerk_client_id_thread, &code, &verifier) {
                        Ok((token, email)) => {
                            let mut s = settings_clone.lock().unwrap();
                            s.auth_token = token;
                            s.user_email = email.clone();
                            s.save(&config_dir_path);
                            eprintln!("[auth] Signed in{}", if email.is_empty() { String::new() } else { format!(" as {}", email) });
                        }
                        Err(e) => eprintln!("[auth] Token exchange failed: {}", e),
                    }
                } else {
                    eprintln!("[auth] No code in redirect: {}", request_line.trim());
                }
            }
            Err(e) => eprintln!("[auth] Accept error: {}", e),
        }
    });

    // Clerk's authorization URL for native PKCE.
    // /v1/oauth_authorize is Clerk's PKCE endpoint (Clerk as OAuth identity provider).
    // The strategy parameter does NOT belong here — it belongs to the social sign-in
    // custom flow (/v1/client/sign_ins) and causes a 404 on this endpoint.
    // Users choose their social provider on Clerk's hosted sign-in page.
    let redirect_uri = format!("http://127.0.0.1:{}/", OAUTH_CALLBACK_PORT);
    let auth_url = format!(
        "https://{}/v1/oauth_authorize?response_type=code&client_id={}&redirect_uri={}&code_challenge={}&code_challenge_method=S256&scope=profile%20email",
        clerk_domain,
        urlencoding::encode(&clerk_client_id),
        urlencoding::encode(&redirect_uri),
        challenge,
    );
    app.opener().open_url(&auth_url, None::<&str>).map_err(|e| e.to_string())?;

    Ok("Browser opened — complete sign-in to continue.".to_string())
}

#[tauri::command]
fn logout(
    settings: tauri::State<Arc<Mutex<Settings>>>,
    config_dir: tauri::State<ConfigDir>,
) {
    let mut s = settings.lock().unwrap();
    s.auth_token = String::new();
    s.user_email = String::new();
    s.save(&config_dir.0);
}

#[tauri::command]
fn get_auth_status(settings: tauri::State<Arc<Mutex<Settings>>>) -> serde_json::Value {
    let s = settings.lock().unwrap();
    serde_json::json!({
        "is_authenticated": s.is_authenticated(),
        "email": s.user_email,
    })
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn get_recorder_status(
    state: tauri::State<Arc<Mutex<RecorderState>>>,
    results_buffer: tauri::State<ResultsBuffer>,
) -> String {
    let s = state.lock().unwrap();

    let pending_sessions = count_pending_files(&results_buffer.0);

    let (status_class, status_label) = match s.status {
        RecorderStatus::LmuNotRunning => ("status--offline", "LMU not running"),
        RecorderStatus::Connected => ("status--connected", "Connected"),
        RecorderStatus::Recording => ("status--recording", "Recording"),
    };

    let lap_html = if s.current_lap > 0 {
        format!("<p class=\"lap\">{}</p>", s.current_lap)
    } else {
        String::new()
    };

    let total_pending = s.pending_laps + pending_sessions;
    let pending_html = if total_pending > 0 {
        let mut parts = Vec::new();
        if s.pending_laps > 0 {
            parts.push(format!("{} lap{}", s.pending_laps, if s.pending_laps == 1 { "" } else { "s" }));
        }
        if pending_sessions > 0 {
            parts.push(format!("{} session{}", pending_sessions, if pending_sessions == 1 { "" } else { "s" }));
        }
        format!(
            r##"<div class="pending">
                <span>{} pending upload</span>
                <button hx-post="command:upload_now" hx-target="#status" hx-swap="innerHTML">Upload now</button>
            </div>"##,
            parts.join(", ")
        )
    } else {
        String::new()
    };

    format!(
        r#"<div class="status {status_class}">
            <span class="dot"></span>
            <span>{status_label}</span>
        </div>
        {lap_html}
        {pending_html}"#
    )
}

fn count_pending_files(dir: &std::path::Path) -> usize {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| {
                    e.path().to_str().map(|s| s.ends_with(".json.gz")).unwrap_or(false)
                })
                .count()
        })
        .unwrap_or(0)
}

#[tauri::command]
fn upload_now(
    telemetry_buffer: tauri::State<PathBuf>,
    results_buffer: tauri::State<ResultsBuffer>,
    settings: tauri::State<Arc<Mutex<Settings>>>,
) -> String {
    let s = settings.lock().unwrap().clone();
    if !s.is_authenticated() {
        return r#"<span class="upload-msg upload-msg--warn">Not logged in — configure your auth token in settings.</span>"#.to_string();
    }
    let (laps, sessions) =
        upload::upload_all(&telemetry_buffer, &results_buffer.0, &s);
    format!(
        r#"<span class="upload-msg">Uploaded {} lap{}, {} session{}.</span>"#,
        laps,
        if laps == 1 { "" } else { "s" },
        sessions,
        if sessions == 1 { "" } else { "s" },
    )
}

#[tauri::command]
fn get_settings(settings: tauri::State<Arc<Mutex<Settings>>>) -> Settings {
    settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(
    new_settings: Settings,
    config_dir: tauri::State<ConfigDir>,
    settings: tauri::State<Arc<Mutex<Settings>>>,
) {
    new_settings.save(&config_dir.0);
    *settings.lock().unwrap() = new_settings;
}

// ── Newtype wrappers so Tauri can manage multiple PathBufs ────────────────────

struct ResultsBuffer(PathBuf);
struct ConfigDir(PathBuf);

// ── App setup ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from(".apxeer"));

            let buffer_dir = app_dir.join("buffer");
            let results_buffer = app_dir.join("results");
            let config_dir = app_dir.join("config");

            for dir in [&buffer_dir, &results_buffer, &config_dir] {
                std::fs::create_dir_all(dir).expect("Failed to create app directory");
            }

            eprintln!("[setup] App dir: {:?}", app_dir);

            // Load settings from disk.
            let settings = Settings::load(&config_dir);
            eprintln!("[setup] Auto-upload: {}, API: {}", settings.auto_upload, settings.api_url);

            let settings = Arc::new(Mutex::new(settings));
            app.manage(settings.clone());
            app.manage(buffer_dir.clone());
            app.manage(ResultsBuffer(results_buffer.clone()));
            app.manage(ConfigDir(config_dir));

            // Start telemetry recorder.
            let recorder_state = Arc::new(Mutex::new(RecorderState::initial()));
            app.manage(recorder_state.clone());
            telemetry::start(buffer_dir.clone(), recorder_state);

            // Start XML results watcher.
            let lmu_results_dir = {
                let s = settings.lock().unwrap();
                s.lmu_results_path().unwrap_or_else(detect_lmu_results_dir)
            };
            if lmu_results_dir.exists() {
                eprintln!("[setup] Watching LMU results: {:?}", lmu_results_dir);
            } else {
                eprintln!("[setup] LMU results dir not found, watcher will idle");
            }
            results::start(lmu_results_dir, results_buffer.clone());

            // Start upload loop (auto-uploads every 30s when enabled).
            upload::start(buffer_dir, results_buffer, settings);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_recorder_status,
            upload_now,
            get_settings,
            save_settings,
            login_oauth,
            logout,
            get_auth_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
