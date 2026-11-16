import { invoke } from "@tauri-apps/api/core";

interface OverlayTelemetry {
  speed: number;
  gear: number;
  throttle: number;
  brake: number;
}

const status = document.getElementById("telemetry-status")!;
const telemetry = document.getElementById("telemetry")!;
const gear = document.getElementById("gear")!;
const speed = document.getElementById("speed")!;
const throttle = document.querySelector<HTMLProgressElement>("#throttle")!;
const brake = document.querySelector<HTMLProgressElement>("#brake")!;

async function refreshTelemetry() {
  try {
    const sample = await invoke<OverlayTelemetry | null>("get_overlay_telemetry");
    status.hidden = sample !== null;
    telemetry.hidden = sample === null;
    if (sample) {
      gear.textContent = sample.gear < 0 ? "R" : sample.gear === 0 ? "N" : String(sample.gear);
      speed.textContent = String(Math.round(sample.speed));
      throttle.value = sample.throttle;
      brake.value = sample.brake;
    } else {
      status.textContent = "Waiting for LMU telemetry";
    }
  } catch {
    telemetry.hidden = true;
    status.hidden = false;
    status.textContent = "Telemetry unavailable";
  }
  window.setTimeout(refreshTelemetry, 50);
}

void refreshTelemetry();
