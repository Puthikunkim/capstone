const API_BASE = "http://localhost:8000/api";

async function request(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

// ── ECU ──────────────────────────────────────────────────────────────
export const fetchEcus = () => request("/ecu");

export const fetchEcu = (ecuId) => request(`/ecu/${ecuId}`);

export const fetchEcuHistory = (ecuId, limit = 100) =>
  request(`/ecu/${ecuId}/history?limit=${limit}`);

export const configureEcu = (ecuId, config) =>
  request(`/ecu/${ecuId}/configure`, {
    method: "POST",
    body: JSON.stringify(config),
  });

// ── Violations / Alerts ───────────────────────────────────────────────
export const fetchViolations = (ecuId, limit = 50) =>
  request(`/violations?ecu_id=${ecuId}&limit=${limit}`);

// ── Firmware ──────────────────────────────────────────────────────────
export const fetchFirmwareStatus = (ecuId) =>
  request(`/${ecuId}/firmware/status`);

export async function uploadFirmware(ecuId, file) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}/${ecuId}/firmware`, {
    method: "POST",
    body: form,
    // No Content-Type header — browser sets it with the boundary automatically
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || `${response.status} ${response.statusText}`);
  }
  return response.json();
}
