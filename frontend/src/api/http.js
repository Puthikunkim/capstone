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

// ── Competitions ──────────────────────────────────────────────────────
export const fetchCompetitions = () => request("/competitions");
export const fetchCompetition = (id) => request(`/competitions/${id}`);
export const createCompetition = (name, eventTypes) =>
  request("/competitions/", { method: "POST", body: JSON.stringify({ name, event_types: eventTypes }) });
export const fetchCompetitionTeams = (competitionId) =>
  request(`/competitions/${competitionId}/teams`);

// ── Teams ─────────────────────────────────────────────────────────────
export const fetchTeams = () => request("/teams");
export const createTeam = (payload) =>
  request("/teams/", { method: "POST", body: JSON.stringify(payload) });
export const fetchTeam = (teamId) => request(`/teams/${teamId}`);
export const fetchTeamEcus = (teamId) => request(`/teams/${teamId}/ecus`);
export const fetchAvailableEcus = () => request("/teams/available-ecus");
export const assignEcuToTeam = (teamId, ecuId) =>
  request(`/teams/${teamId}/assign/${ecuId}`, { method: "POST" });
export const unassignEcuFromTeam = (teamId, ecuId) =>
  request(`/teams/${teamId}/unassign/${ecuId}`, { method: "POST" });

export const addTeamToCompetition = (competitionId, teamId) =>
  request(`/competitions/${competitionId}/teams/${teamId}`, { method: "POST" });

// ── Event Participants ────────────────────────────────────────────────
export const fetchEventParticipants = (eventId) =>
  request(`/event-participants/?event_id=${eventId}`);

export const updateEventParticipant = (participantId, payload) =>
  request(`/event-participants/${participantId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

// ── Violations / Alerts ───────────────────────────────────────────────
export const fetchViolations = (ecuId, limit = 50) =>
  request(`/violations?ecu_id=${ecuId}&limit=${limit}`);

export const fetchOpenViolations = () =>
  request("/violations/?open_only=true&limit=100");

export const fetchAlerts = ({ ecuId, start, limit = 50 } = {}) => {
  const p = new URLSearchParams();
  if (ecuId) p.set("ecu_id", ecuId);
  if (start) p.set("start", start);
  p.set("limit", limit);
  return request(`/alerts/?${p.toString()}`);
};

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
