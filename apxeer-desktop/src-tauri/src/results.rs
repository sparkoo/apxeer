use flate2::{write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    thread,
    time::Duration,
};

// ── Data types ────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct ParsedLap {
    pub num: i32,
    pub lap_time_ms: Option<u32>, // None = invalid ("--.----")
    pub s1_ms: Option<u32>,
    pub s2_ms: Option<u32>,
    pub s3_ms: Option<u32>,
    pub top_speed_kph: f32,
    pub fuel_fraction: f32,
    pub fuel_used: f32,
    pub elapsed_time_s: f64,
    pub tyre_wear_fl: f32,
    pub tyre_wear_fr: f32,
    pub tyre_wear_rl: f32,
    pub tyre_wear_rr: f32,
    pub tyre_compound: String, // e.g. "Medium", "Wet"
    pub is_pit_lap: bool,
    pub race_position: Option<i32>,
}

#[derive(Serialize, Deserialize)]
pub struct ParsedDriver {
    pub name: String,
    pub car_type: String,
    pub car_class: String,
    pub car_number: String,
    pub team_name: String,
    pub is_player: bool,
    pub is_connected: bool,
    pub grid_pos: Option<i32>,
    pub class_grid_pos: Option<i32>,
    pub finish_pos: i32,
    pub class_pos: i32,
    pub laps_completed: i32,
    pub best_lap_ms: Option<u32>,
    pub finish_time_s: Option<f64>,
    pub pitstops: i32,
    pub finish_status: String,
    pub laps: Vec<ParsedLap>,
}

#[derive(Serialize, Deserialize)]
pub struct ParsedStreamEvent {
    pub event_type: String,    // "incident" | "penalty" | "track_limits"
    pub elapsed_time: f64,
    pub driver_name: String,
    pub detail: serde_json::Value,
    pub description: String,
}

#[derive(Serialize, Deserialize)]
pub struct ParsedSessionBlock {
    /// Normalised type: "Practice", "Qualifying", or "Race"
    pub session_type: String,
    pub session_datetime: i64,
    pub duration_minutes: i32,
    pub drivers: Vec<ParsedDriver>,
    pub stream_events: Vec<ParsedStreamEvent>,
}

#[derive(Serialize, Deserialize)]
pub struct ParsedSession {
    pub track_venue: String,
    pub track_course: String,
    pub track_event: String,
    pub track_length_m: f64,
    pub game_version: String,
    pub setting: String,
    pub server_name: String,
    pub fuel_mult: f64,
    pub tire_mult: f64,
    pub damage_mult: i32,
    /// Unix timestamp from the XML <DateTime> field (root level — identifies the event)
    pub datetime: i64,
    pub source_filename: String,
    pub session_blocks: Vec<ParsedSessionBlock>,
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Spawn the results watcher in a background thread.
///
/// Polls `watch_dir` every 5 seconds for new XML files and saves parsed
/// results as `.json.gz` into `buffer_dir`.
pub fn start(watch_dir: PathBuf, buffer_dir: PathBuf) {
    thread::spawn(move || scan_loop(watch_dir, buffer_dir));
}

// ── Watcher loop ──────────────────────────────────────────────────────────────

fn scan_loop(watch_dir: PathBuf, buffer_dir: PathBuf) {
    let mut seen: HashSet<PathBuf> = HashSet::new();

    loop {
        if watch_dir.exists() {
            match std::fs::read_dir(&watch_dir) {
                Ok(entries) => {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.extension().map(|e| e == "xml").unwrap_or(false)
                            && !seen.contains(&path)
                            && !is_processed(&path, &buffer_dir)
                        {
                            process_xml(&path, &buffer_dir);
                            seen.insert(path);
                        }
                    }
                }
                Err(e) => eprintln!("[results] Failed to read watch dir: {}", e),
            }
        }
        thread::sleep(Duration::from_secs(5));
    }
}

fn is_processed(xml_path: &Path, buffer_dir: &Path) -> bool {
    let stem = xml_path.file_name().unwrap_or_default();
    let out = buffer_dir.join(format!("{}.json.gz", stem.to_string_lossy()));
    out.exists()
}

fn process_xml(path: &Path, buffer_dir: &Path) {
    eprintln!("[results] Processing {:?}", path.file_name().unwrap_or_default());
    match parse_xml(path) {
        Ok(session) => {
            if session.setting != "Multiplayer" {
                eprintln!("[results] Skipped {} — not a multiplayer session ({})", session.source_filename, session.setting);
                return;
            }
            if session.session_blocks.is_empty() {
                eprintln!("[results] Skipped {} — no race session blocks", session.source_filename);
                return;
            }
            if let Err(e) = save_session(&session, buffer_dir) {
                eprintln!("[results] Failed to save {:?}: {}", path, e);
            } else {
                eprintln!(
                    "[results] Saved {} — {} race block(s), {} total drivers",
                    session.source_filename,
                    session.session_blocks.len(),
                    session.session_blocks.iter().map(|b| b.drivers.len()).sum::<usize>()
                );
            }
        }
        Err(e) => eprintln!("[results] Failed to parse {:?}: {}", path, e),
    }
}

// ── XML parser ────────────────────────────────────────────────────────────────

fn parse_xml(path: &Path) -> Result<ParsedSession, Box<dyn std::error::Error>> {
    let raw = std::fs::read_to_string(path)?;

    let opts = roxmltree::ParsingOptions {
        allow_dtd: true, // LMU XMLs include a DOCTYPE with an entity declaration
        ..Default::default()
    };
    let doc = roxmltree::Document::parse_with_options(&raw, opts)?;

    let root = doc
        .descendants()
        .find(|n| n.has_tag_name("RaceResults"))
        .ok_or("Missing <RaceResults>")?;

    let track_venue = child_text(&root, "TrackVenue").unwrap_or_default();
    let track_course = child_text(&root, "TrackCourse").unwrap_or_default();
    let track_event = child_text(&root, "TrackEvent").unwrap_or_default();
    let track_length_m = child_text(&root, "TrackLength")
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);
    let game_version = child_text(&root, "GameVersion").unwrap_or_default();
    let setting = child_text(&root, "Setting").unwrap_or_default();
    let server_name = child_text(&root, "ServerName").unwrap_or_default();
    let fuel_mult = child_text(&root, "FuelMult")
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(1.0);
    let tire_mult = child_text(&root, "TireMult")
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(1.0);
    let damage_mult = child_text(&root, "DamageMult")
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(100);
    let datetime = child_text(&root, "DateTime")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);

    let source_filename = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    let session_tag_names = ["Practice1", "Practice2", "Practice3", "Practice4",
                             "Qualify", "Qualify1", "Qualify2",
                             "Race", "Race1", "Race2", "Race3"];

    let mut session_blocks = Vec::new();

    for tag in &session_tag_names {
        if let Some(block_node) = root.children().find(|n| n.has_tag_name(*tag)) {
            let session_type = normalise_session_type(tag);

            // Only upload Race sessions — skip Practice and Qualifying.
            if session_type != "Race" {
                continue;
            }

            let session_datetime = child_text(&block_node, "DateTime")
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(datetime);
            let duration_minutes = child_text(&block_node, "Minutes")
                .and_then(|s| s.parse::<i32>().ok())
                .unwrap_or(0);

            let drivers = block_node
                .children()
                .filter(|n| n.has_tag_name("Driver"))
                .map(parse_driver)
                .collect();

            let stream_events = block_node
                .children()
                .find(|n| n.has_tag_name("Stream"))
                .map(|s| parse_stream_events(&s))
                .unwrap_or_default();

            session_blocks.push(ParsedSessionBlock {
                session_type,
                session_datetime,
                duration_minutes,
                drivers,
                stream_events,
            });
        }
    }

    Ok(ParsedSession {
        track_venue,
        track_course,
        track_event,
        track_length_m,
        game_version,
        setting,
        server_name,
        fuel_mult,
        tire_mult,
        damage_mult,
        datetime,
        source_filename,
        session_blocks,
    })
}

fn parse_driver(node: roxmltree::Node) -> ParsedDriver {
    let name = child_text(&node, "Name").unwrap_or_default();
    let car_type = child_text(&node, "CarType").unwrap_or_default();
    let car_class = child_text(&node, "CarClass").unwrap_or_default();
    let car_number = child_text(&node, "CarNumber").unwrap_or_default();
    let team_name = child_text(&node, "TeamName").unwrap_or_default();
    let is_player = child_text(&node, "isPlayer").map(|s| s == "1").unwrap_or(false);
    let is_connected = child_text(&node, "Connected").map(|s| s == "1").unwrap_or(false);

    let grid_pos = child_text(&node, "GridPos").and_then(|s| s.parse::<i32>().ok());
    let class_grid_pos = child_text(&node, "ClassGridPos").and_then(|s| s.parse::<i32>().ok());
    let finish_pos = child_text(&node, "Position")
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(0);
    let class_pos = child_text(&node, "ClassPosition")
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(0);
    let laps_completed = child_text(&node, "Laps")
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(0);
    let best_lap_ms = child_text(&node, "BestLapTime")
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|&t| t > 0.0)
        .map(|t| (t * 1000.0) as u32);
    let pitstops = child_text(&node, "Pitstops")
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(0);
    let finish_time_s = child_text(&node, "FinishTime")
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|&t| t > 0.0);
    let finish_status = child_text(&node, "FinishStatus").unwrap_or_default();

    let laps = node
        .children()
        .filter(|n| n.has_tag_name("Lap"))
        .map(parse_lap)
        .collect();

    ParsedDriver {
        name,
        car_type,
        car_class,
        car_number,
        team_name,
        is_player,
        is_connected,
        grid_pos,
        class_grid_pos,
        finish_pos,
        class_pos,
        laps_completed,
        best_lap_ms,
        finish_time_s,
        pitstops,
        finish_status,
        laps,
    }
}

fn parse_lap(node: roxmltree::Node) -> ParsedLap {
    let attr = |key: &str| node.attribute(key);
    let attr_f32 = |key: &str| attr(key).and_then(|v| v.parse::<f32>().ok()).unwrap_or(0.0);
    let attr_sec_ms =
        |key: &str| attr(key).and_then(|v| v.parse::<f64>().ok()).filter(|&t| t > 0.0).map(|t| (t * 1000.0) as u32);

    let num = attr("num").and_then(|v| v.parse::<i32>().ok()).unwrap_or(0);
    let race_position = attr("p").and_then(|v| v.parse::<i32>().ok());
    let is_pit_lap = attr("pit").map(|v| v == "1").unwrap_or(false);

    // Lap time is the text content; "--.----" or missing = invalid
    let lap_time_ms = node
        .text()
        .and_then(|t| t.trim().parse::<f64>().ok())
        .filter(|&t| t > 0.0)
        .map(|t| (t * 1000.0) as u32);

    let s1_ms = attr_sec_ms("s1");
    let s2_ms = attr_sec_ms("s2");
    let s3_ms = attr_sec_ms("s3");

    let elapsed_time_s = attr("et").and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
    let top_speed_kph = attr_f32("topspeed");
    let fuel_fraction = attr_f32("fuel");
    let fuel_used = attr_f32("fuelUsed");
    let tyre_wear_fl = attr_f32("twfl");
    let tyre_wear_fr = attr_f32("twfr");
    let tyre_wear_rl = attr_f32("twrl");
    let tyre_wear_rr = attr_f32("twrr");

    // fcompound="0,Medium" → "Medium"
    let tyre_compound = attr("fcompound")
        .and_then(|v| v.split(',').nth(1))
        .unwrap_or("Unknown")
        .to_string();

    ParsedLap {
        num,
        lap_time_ms,
        s1_ms,
        s2_ms,
        s3_ms,
        top_speed_kph,
        fuel_fraction,
        fuel_used,
        elapsed_time_s,
        tyre_wear_fl,
        tyre_wear_fr,
        tyre_wear_rl,
        tyre_wear_rr,
        tyre_compound,
        is_pit_lap,
        race_position,
    }
}

// ── Stream event parsing ─────────────────────────────────────────────────────

fn parse_stream_events(stream_node: &roxmltree::Node) -> Vec<ParsedStreamEvent> {
    let mut events = Vec::new();

    for node in stream_node.children() {
        if node.has_tag_name("Incident") {
            if let Some(ev) = parse_incident(&node) {
                events.push(ev);
            }
        } else if node.has_tag_name("Penalty") {
            if let Some(ev) = parse_penalty(&node) {
                events.push(ev);
            }
        } else if node.has_tag_name("TrackLimits") {
            if let Some(ev) = parse_track_limits(&node) {
                events.push(ev);
            }
        }
    }

    events
}

fn parse_incident(node: &roxmltree::Node) -> Option<ParsedStreamEvent> {
    let et = node.attribute("et").and_then(|v| v.parse::<f64>().ok())?;
    let text = node.text().unwrap_or_default().to_string();

    // Format: "Name(ID) reported contact (VALUE) with another vehicle OtherName(ID)"
    //     or: "Name(ID) reported contact (VALUE) with Immovable"
    let reported = " reported contact (";
    let reported_pos = text.find(reported)?;

    // Driver name: everything before the last '(' before " reported contact"
    let driver_part = &text[..reported_pos];
    let driver_name = driver_part.rsplit_once('(')
        .map(|(name, _)| name.to_string())
        .unwrap_or_else(|| driver_part.to_string());

    // Contact value: between "reported contact (" and ")"
    let value_start = reported_pos + reported.len();
    let value_end = text[value_start..].find(')')? + value_start;
    let contact_value: f64 = text[value_start..value_end].parse().unwrap_or(0.0);

    // After ") with " — either "another vehicle OtherName(ID)" or "Immovable"
    let with_marker = ") with ";
    let with_pos = text[value_start..].find(with_marker)? + value_start + with_marker.len();
    let remainder = &text[with_pos..];

    let detail = if remainder.starts_with("another vehicle ") {
        let other_part = &remainder["another vehicle ".len()..];
        let other_name = other_part.rsplit_once('(')
            .map(|(name, _)| name.to_string())
            .unwrap_or_else(|| other_part.to_string());
        serde_json::json!({
            "other_driver": other_name,
            "contact_value": contact_value
        })
    } else {
        serde_json::json!({
            "object": remainder.to_string(),
            "contact_value": contact_value
        })
    };

    Some(ParsedStreamEvent {
        event_type: "incident".to_string(),
        elapsed_time: et,
        driver_name,
        detail,
        description: text,
    })
}

fn parse_penalty(node: &roxmltree::Node) -> Option<ParsedStreamEvent> {
    let et = node.attribute("et").and_then(|v| v.parse::<f64>().ok())?;
    let text = node.text().unwrap_or_default().to_string();

    // Newer format has attributes: Driver, Penalty, Reason
    let driver_attr = node.attribute("Driver").map(|s| s.to_string());
    let penalty_type = node.attribute("Penalty").map(|s| s.to_string());
    let reason = node.attribute("Reason").map(|s| s.to_string());

    let (driver, detail) = if let (Some(drv), Some(pt)) = (driver_attr, penalty_type) {
        (drv, serde_json::json!({
            "penalty_type": pt,
            "reason": reason.unwrap_or_default()
        }))
    } else {
        // Older format: "Name received Type penalty, ... for Reason. ..."
        let received = " received ";
        if let Some(pos) = text.find(received) {
            let drv = text[..pos].to_string();
            let rest = &text[pos + received.len()..];
            let pt = rest.split(" penalty").next().unwrap_or("Unknown").to_string();
            let reason = rest.find(" for ")
                .map(|p| rest[p + 5..].split('.').next().unwrap_or("").trim_matches('"').to_string())
                .unwrap_or_default();
            (drv, serde_json::json!({
                "penalty_type": pt,
                "reason": reason
            }))
        } else {
            let drv = text.split(' ').next().unwrap_or("Unknown").to_string();
            (drv, serde_json::json!({}))
        }
    };

    Some(ParsedStreamEvent {
        event_type: "penalty".to_string(),
        elapsed_time: et,
        driver_name: driver,
        detail,
        description: text,
    })
}

fn parse_track_limits(node: &roxmltree::Node) -> Option<ParsedStreamEvent> {
    let et = node.attribute("et").and_then(|v| v.parse::<f64>().ok())?;
    let driver_name = node.attribute("Driver").unwrap_or_default().to_string();
    let lap = node.attribute("Lap").and_then(|v| v.parse::<i32>().ok()).unwrap_or(0);
    let warning_points = node.attribute("WarningPoints")
        .and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
    let current_points = node.attribute("CurrentPoints")
        .and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
    let resolution = node.text().unwrap_or_default().trim().to_string();

    let detail = serde_json::json!({
        "lap": lap,
        "warning_points": warning_points,
        "current_points": current_points,
        "resolution": &resolution
    });

    Some(ParsedStreamEvent {
        event_type: "track_limits".to_string(),
        elapsed_time: et,
        driver_name,
        detail,
        description: resolution,
    })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn child_text<'a>(node: &roxmltree::Node<'a, 'a>, tag: &str) -> Option<String> {
    node.children()
        .find(|n| n.has_tag_name(tag))
        .and_then(|n| n.text())
        .map(|t| t.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn normalise_session_type(tag: &str) -> String {
    if tag.starts_with("Practice") {
        "Practice".to_string()
    } else if tag.starts_with("Qualify") {
        "Qualifying".to_string()
    } else {
        "Race".to_string()
    }
}

fn save_session(
    session: &ParsedSession,
    buffer_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let filename = format!("{}.json.gz", session.source_filename);
    let path = buffer_dir.join(filename);

    let file = std::fs::File::create(&path)?;
    let mut gz = GzEncoder::new(file, Compression::default());
    serde_json::to_writer(&mut gz, session)?;
    gz.finish()?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_race_xml() {
        let path = std::path::Path::new(
            r"C:\Users\michal\dev\apxeer\lmu-telemetry\results\2026_03_01_13_56_27-87R1.xml",
        );
        let session = parse_xml(path).expect("parse failed");
        assert_eq!(session.track_venue, "Autodromo Enzo e Dino Ferrari");
        assert!(!session.track_course.is_empty());
        assert!(!session.setting.is_empty());
        assert!(session.fuel_mult > 0.0);
        assert!(!session.session_blocks.is_empty());

        let race = session.session_blocks.iter().find(|b| b.session_type == "Race").expect("no race block");
        assert!(race.session_datetime > 0);
        assert!(!race.drivers.is_empty());

        let driver = &race.drivers[0];
        assert!(!driver.name.is_empty());
        assert!(driver.is_connected);
        assert!(!driver.laps.is_empty());

        // Verify lap enrichment
        let lap = &driver.laps[0];
        assert!(lap.elapsed_time_s > 0.0, "elapsed_time_s should be populated");

        // Verify stream events parsed
        assert!(!race.stream_events.is_empty(), "stream events should be parsed");
        println!("Track: {}, {} drivers, {} laps for first driver, {} stream events",
            session.track_venue, race.drivers.len(), driver.laps.len(), race.stream_events.len());
    }

    #[test]
    fn skips_practice_xml() {
        let path = std::path::Path::new(
            r"C:\Users\michal\dev\apxeer\lmu-telemetry\results\2026_03_04_05_51_30-39P1.xml",
        );
        let session = parse_xml(path).expect("parse failed");
        // Practice-only files produce no blocks — nothing to upload.
        assert!(session.session_blocks.is_empty(), "practice should be filtered out");
        assert!(!session.track_course.is_empty());
    }
}
