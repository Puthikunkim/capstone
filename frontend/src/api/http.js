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

export const fetchEcuHistory = (ecuId, { limit, teamId, before } = {}) => {
  const p = new URLSearchParams();
  if (limit != null) p.set("limit", limit);
  if (teamId != null) p.set("team_id", teamId);
  if (before != null) p.set("before", before);
  const qs = p.toString();
  return request(`/ecu/${ecuId}/history${qs ? `?${qs}` : ""}`);
};

export const fetchTeamFrames = (teamId, { eventId, before, limit } = {}) => {
  const p = new URLSearchParams();
  if (eventId != null) p.set("event_id", eventId);
  if (before != null) p.set("before", before);
  if (limit != null) p.set("limit", limit);
  const qs = p.toString();
  return request(`/teams/${teamId}/frames${qs ? `?${qs}` : ""}`);
};

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

export const removeTeamFromCompetition = (competitionId, teamId) =>
  request(`/competitions/${competitionId}/teams/${teamId}`, { method: "DELETE" });

// ── Event Participants ────────────────────────────────────────────────
export const fetchEventParticipants = (eventId) =>
  request(`/event-participants/?event_id=${eventId}`);

export const updateEventParticipant = (participantId, payload) =>
  request(`/event-participants/${participantId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

// ── Scoring / Leaderboard ─────────────────────────────────────────────
export const fetchEventLeaderboard = (eventId) =>
  request(`/scoring/event-leaderboard/${eventId}`);

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

