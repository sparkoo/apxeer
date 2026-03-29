use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Settings {
    /// Base URL of the Apxeer API.
    pub api_url: String,
    /// Clerk JWT for authenticated uploads. Empty = not logged in.
    pub auth_token: String,
    /// Email of the signed-in user. Empty = not logged in.
    pub user_email: String,
    /// Auto-upload completed laps/results, or wait for manual trigger.
    pub auto_upload: bool,
    /// Path to the LMU results XML folder.
    pub lmu_results_dir: String,
    /// Clerk Frontend API domain (e.g. "your-app.clerk.accounts.dev").
    /// Set this in the app settings to match your Clerk project.
    #[serde(default)]
    pub clerk_domain: String,
    /// Clerk Publishable Key (e.g. "pk_test_..."). Used as OAuth client_id in PKCE flow.
    #[serde(default)]
    pub clerk_publishable_key: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            api_url: "http://localhost:8080".to_string(),
            auth_token: String::new(),
            user_email: String::new(),
            auto_upload: false,
            lmu_results_dir: String::new(),
            clerk_domain: String::new(),
            clerk_publishable_key: String::new(),
        }
    }
}

impl Settings {
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join("settings.json");
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, config_dir: &Path) {
        let path = config_dir.join("settings.json");
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(path, json);
        }
    }

    pub fn is_authenticated(&self) -> bool {
        !self.auth_token.is_empty()
    }

    pub fn lmu_results_path(&self) -> Option<PathBuf> {
        if self.lmu_results_dir.is_empty() {
            None
        } else {
            Some(PathBuf::from(&self.lmu_results_dir))
        }
    }
}
