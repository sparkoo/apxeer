import "htmx.org";
import "tauri-plugin-htmx";
import { invoke } from "@tauri-apps/api/core";

interface Settings {
  api_url: string;
  clerk_domain: string;
  clerk_oauth_client_id: string;
  auth_token: string;
  user_email: string;
  auto_upload: boolean;
  lmu_results_dir: string;
}

interface AuthStatus {
  is_authenticated: boolean;
  email: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

let authPollInterval: ReturnType<typeof setInterval> | null = null;

async function renderAuth() {
  const container = document.getElementById("account-content");
  if (!container) return;

  const status = await invoke<AuthStatus>("get_auth_status");

  if (status.is_authenticated) {
    if (authPollInterval !== null) {
      clearInterval(authPollInterval);
      authPollInterval = null;
    }
    container.innerHTML = `
      <div class="auth-signed-in">
        <span class="auth-email">${status.email}</span>
        <button id="signout-btn" class="btn-secondary">Sign out</button>
      </div>
    `;
    document.getElementById("signout-btn")?.addEventListener("click", async () => {
      await invoke("logout");
      renderAuth();
    });
  } else {
    container.innerHTML = `
      <div class="auth-providers">
        <button class="btn-provider" id="signin-btn">Sign in</button>
      </div>
      <p class="auth-msg" id="auth-msg"></p>
    `;
    document.getElementById("signin-btn")?.addEventListener("click", async () => {
      const msg = document.getElementById("auth-msg")!;
      try {
        const result = await invoke<string>("login_oauth");
        msg.textContent = result;
        if (authPollInterval === null) {
          authPollInterval = setInterval(renderAuth, 2000);
        }
      } catch (e) {
        msg.textContent = String(e);
      }
    });
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function initSettings() {
  const form = document.getElementById("settings-form") as HTMLFormElement;
  if (!form) return;

  const s: Settings = await invoke("get_settings");
  (form.elements.namedItem("api_url") as HTMLInputElement).value = s.api_url;
  (form.elements.namedItem("clerk_domain") as HTMLInputElement).value = s.clerk_domain ?? "";
  (form.elements.namedItem("clerk_oauth_client_id") as HTMLInputElement).value = s.clerk_oauth_client_id ?? "";
  (form.elements.namedItem("lmu_results_dir") as HTMLInputElement).value = s.lmu_results_dir;
  (form.elements.namedItem("auto_upload") as HTMLInputElement).checked = s.auto_upload;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("settings-msg")!;
    try {
      // Fetch current to preserve auth fields not in this form
      const current = await invoke<Settings>("get_settings");
      await invoke("save_settings", {
        newSettings: {
          api_url: (form.elements.namedItem("api_url") as HTMLInputElement).value,
          clerk_domain: (form.elements.namedItem("clerk_domain") as HTMLInputElement).value,
          clerk_oauth_client_id: (form.elements.namedItem("clerk_oauth_client_id") as HTMLInputElement).value,
          lmu_results_dir: (form.elements.namedItem("lmu_results_dir") as HTMLInputElement).value,
          auto_upload: (form.elements.namedItem("auto_upload") as HTMLInputElement).checked,
          auth_token: current.auth_token,
          user_email: current.user_email,
        },
      });
      msg.textContent = "Saved";
      msg.className = "settings-msg settings-msg--ok";
    } catch {
      msg.textContent = "Error saving";
      msg.className = "settings-msg settings-msg--err";
    }
    setTimeout(() => { msg.textContent = ""; }, 2000);
  });
}

renderAuth();
initSettings();
