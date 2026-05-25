import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";

const _EVENT_LABELS = {
  drag_race: "Drag Race",
  gymkhana: "Gymkhana",
  endurance_efficiency: "Endurance & Efficiency",
};

const _EVENT_DESCRIPTIONS = {
  drag_race: "Head-to-head straight-line sprint — lowest time wins",
  gymkhana: "Timed agility course with gates and slaloms",
  endurance_efficiency: "Long-distance run scored on energy efficiency",
};

const _EVENT_ICONS = {
  drag_race: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
      <path d="M4 12a.75.75 0 01.75-.75h11.69l-2.72-2.72a.75.75 0 011.06-1.06l4 4a.75.75 0 010 1.06l-4 4a.75.75 0 01-1.06-1.06l2.72-2.72H4.75A.75.75 0 014 12z"/>
    </svg>
  ),
  gymkhana: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
      <path fillRule="evenodd" d="M12 2a10 10 0 100 20A10 10 0 0012 2zM4 12a8 8 0 1116 0A8 8 0 014 12zm8-4a.75.75 0 01.75.75v3.44l2.78 2.78a.75.75 0 01-1.06 1.06l-3-3A.75.75 0 0111.25 12V8.75A.75.75 0 0112 8z" clipRule="evenodd"/>
    </svg>
  ),
  endurance_efficiency: (
    <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
      <path d="M13 2.05v2.02c3.95.49 7 3.85 7 7.93 0 3.21-1.81 6-4.72 7.72L13 17v5h5l-1.22-1.22C19.91 19.07 22 15.76 22 12c0-5.18-3.95-9.45-9-9.95zM11 2.05C5.95 2.55 2 6.82 2 12c0 3.76 2.09 7.07 5.22 8.78L6 22h5v-5l-2.28 2.72C7.01 18.49 6 15.63 6 12c0-4.08 3.05-7.44 7-7.93V2.05z"/>
    </svg>
  ),
};

function EventsPanel({ events, onSelectEvent }) {
  return (
    <div className="events-panel">
      <div className="events-panel-header">
        <h2>Events</h2>
        <p>Select an event to view its leaderboard and live team data</p>
      </div>
      {events.length === 0 ? (
        <div className="events-panel-empty">
          <svg viewBox="0 0 48 48" fill="none" width="48" height="48">
            <circle cx="24" cy="24" r="18" stroke="currentColor" strokeWidth="2" />
            <path d="M24 16v8l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p>No events in this competition</p>
        </div>
      ) : (
        <div className="events-panel-grid">
          {events.map((ev) => (
            <div key={ev.id} className="event-panel-card" onClick={() => onSelectEvent(ev)}>
              <div className="event-panel-icon-wrap">
                {_EVENT_ICONS[ev.event_type]}
              </div>
              <div className="event-panel-name">{_EVENT_LABELS[ev.event_type] ?? ev.event_type}</div>
              <div className="event-panel-desc">{_EVENT_DESCRIPTIONS[ev.event_type] ?? ""}</div>
              <span className="event-panel-cta">View Leaderboard →</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

EventsPanel.propTypes = {
  events: PropTypes.array.isRequired,
  onSelectEvent: PropTypes.func.isRequired,
};

import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { Navbar } from "./components/Navbar";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./pages/Dashboard";
import { CompetitionsPage } from "./pages/CompetitionsPage";
import { AssignEcuModal } from "./components/AssignEcuModal";
import {
  fetchEcus,
  fetchCompetitionTeams,
  unassignEcuFromTeam,
  fetchOpenViolations,
  fetchEventParticipants,
  updateEventParticipant,
  removeTeamFromCompetition,
} from "./api/http";
import { useViolationsWebSocket } from "./hooks/useWebSocket";
import { NotificationPanel } from "./components/NotificationPanel";
import { AddTeamToCompetitionModal } from "./components/AddTeamToCompetitionModal";
import { LeaderboardPage } from "./pages/LeaderboardPage";
import "./App.css";

export default function App() {
  const [selectedCompetition, setSelectedCompetition] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [ecuList, setEcuList] = useState([]);
  const [competitionTeams, setCompetitionTeams] = useState([]);
  const [eventParticipants, setEventParticipants] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [selectedEcuId, setSelectedEcuId] = useState(null);
  const [backendError, setBackendError] = useState(false);
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [showAssignEcu, setShowAssignEcu] = useState(false);
  const [violatingEcuIds, setViolatingEcuIds] = useState(new Set());
  const [violationLog, setViolationLog] = useState([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isDark, setIsDark] = useState(() => localStorage.getItem("theme") !== "light");

  useEffect(() => {
    document.documentElement.classList.toggle("light", !isDark);
    localStorage.setItem("theme", isDark ? "dark" : "light");
  }, [isDark]);
  // tracks which ecu_ids have escalated (confirmed violation) so "ended" knows whether to log
  const escalatedEcuIdsRef = useRef(new Set());
  // stable refs for ecuList / competitionTeams so the WS callback never goes stale
  const ecuListRef = useRef([]);
  const competitionTeamsRef = useRef([]);

  useEffect(() => {
    fetchEcus().then(setEcuList).catch(() => setBackendError(true));
  }, []);

  useEffect(() => {
    if (backendError) return;
    const id = setInterval(() => fetchEcus().then(setEcuList).catch(() => {}), 10000);
    return () => clearInterval(id);
  }, [backendError]);

  // Reset when competition changes
  useEffect(() => {
    if (!selectedCompetition) {
      setCompetitionTeams([]);
      setSelectedEvent(null);
      setEventParticipants([]);
      setSelectedTeam(null);
      setSelectedEcuId(null);
      return;
    }
    setSelectedEvent(null);
    setEventParticipants([]);
    setSelectedTeam(null);
    setSelectedEcuId(null);
    fetchCompetitionTeams(selectedCompetition.id)
      .then(setCompetitionTeams)
      .catch(() => setCompetitionTeams([]));
  }, [selectedCompetition]);

  // Fetch participants when event changes
  useEffect(() => {
    if (!selectedEvent) {
      setEventParticipants([]);
      setSelectedTeam(null);
      setSelectedEcuId(null);
      return;
    }
    fetchEventParticipants(selectedEvent.id)
      .then(setEventParticipants)
      .catch(() => setEventParticipants([]));
  }, [selectedEvent]);

  // Keep refs in sync so the WS violation handler always sees current state
  useEffect(() => { ecuListRef.current = ecuList; }, [ecuList]);
  useEffect(() => { competitionTeamsRef.current = competitionTeams; }, [competitionTeams]);

  // Reset violation log and dot state when competition changes
  useEffect(() => {
    setViolationLog([]);
    setUnreadCount(0);
    escalatedEcuIdsRef.current = new Set();
  }, [selectedCompetition]);

  // Violations WebSocket — reacts to backend-pushed events
  useViolationsWebSocket((event) => {
    const { transition, ecu_id, team_id, is_warning, duration_seconds, penalty_seconds, start_timestamp } = event;

    // ECU not assigned to any team — ignore completely
    if (team_id == null) return;

    // team_id comes directly from the backend (live DB value), so it's never stale.
    // If found in competitionTeamsRef, the ECU belongs to the competition currently on screen.
    const team = competitionTeamsRef.current.find((t) => t.id === team_id);
    const inCurrentCompetition = team != null;
    const label = team?.name ?? `ECU #${ecu_id}`;

    if (transition === "started") {
      if (inCurrentCompetition) {
        toast.warning(`⚡ ${label}: power limit exceeded`, {
          toastId: `warn-${ecu_id}`,
          autoClose: 3000,
        });
      }
    } else if (transition === "escalated") {
      if (inCurrentCompetition) {
        toast.dismiss(`warn-${ecu_id}`);
        toast.error(`🚨 ${label}: power violation confirmed`, {
          toastId: `viol-${ecu_id}`,
          autoClose: false,
        });
        setViolatingEcuIds((prev) => new Set([...prev, ecu_id]));
      }
      escalatedEcuIdsRef.current.add(ecu_id);
    } else if (transition === "ended") {
      if (inCurrentCompetition) {
        toast.dismiss(`warn-${ecu_id}`);
        toast.dismiss(`viol-${ecu_id}`);
        setViolatingEcuIds((prev) => {
          const next = new Set(prev);
          next.delete(ecu_id);
          return next;
        });
      }
      if (escalatedEcuIdsRef.current.has(ecu_id)) {
        escalatedEcuIdsRef.current.delete(ecu_id);
        // Log the entry regardless of competition — panel badge covers non-competition teams too
        const entry = {
          id: event.id,
          teamName: label,
          startTimestamp: start_timestamp,
          durationSeconds: duration_seconds,
          penaltySeconds: penalty_seconds,
          isWarning: is_warning,
        };
        setViolationLog((prev) => [entry, ...prev]);
        setPanelOpen((open) => {
          if (!open) setUnreadCount((n) => n + 1);
          return open;
        });
      }
    }
  });

  // Poll for active violations to drive the red dot on team cards
  useEffect(() => {
    if (!selectedCompetition) {
      setViolatingEcuIds(new Set());
      return;
    }

    const poll = async () => {
      try {
        const open = await fetchOpenViolations();
        const competitionEcuIds = new Set(
          ecuList
            .filter((e) => {
              const teamIds = new Set(competitionTeams.map((t) => t.id));
              return e.team_id && teamIds.has(e.team_id);
            })
            .map((e) => e.id)
        );
        const ids = new Set(
          open.filter((v) => competitionEcuIds.has(v.ecu_id)).map((v) => v.ecu_id)
        );
        setViolatingEcuIds(ids);
      } catch {
        // ignore poll failures
      }
    };

    poll();
    const id = setInterval(poll, 2000);
    return () => {
      clearInterval(id);
      setViolatingEcuIds(new Set());
    };
  }, [selectedCompetition, competitionTeams, ecuList]);

  function refreshCompetitionData() {
    if (!selectedCompetition) return;
    fetchCompetitionTeams(selectedCompetition.id).then(setCompetitionTeams).catch(() => {});
    fetchEcus().then(setEcuList).catch(() => {});
  }

  function refreshEventParticipants() {
    if (!selectedEvent) return;
    fetchEventParticipants(selectedEvent.id).then(setEventParticipants).catch(() => {});
  }

  function handleSelectEvent(event) {
    setSelectedEvent(event);
    setSelectedTeam(null);
    setSelectedEcuId(null);
    if (!event) setEventParticipants([]);
  }

  function handleSelectTeam(team) {
    setSelectedTeam(team);
    const ecu = ecuList.find((e) => e.team_id === team.id);
    setSelectedEcuId(ecu?.id ?? null);
  }

  function handleTeamAdded(team) {
    refreshCompetitionData();
    refreshEventParticipants();
    setSelectedTeam(team);
  }

  async function handleRemoveTeam(team) {
    try {
      await removeTeamFromCompetition(selectedCompetition.id, team.id);
      setCompetitionTeams((prev) => prev.filter((t) => t.id !== team.id));
      if (selectedTeam?.id === team.id) setSelectedTeam(null);
    } catch (err) {
      toast.error(err.message || "Failed to remove team");
    }
  }

  function handleEcuAssigned(ecuId) {
    refreshCompetitionData();
    setSelectedEcuId(ecuId);
  }

  async function handleUnassignEcu(team, ecu) {
    try {
      await unassignEcuFromTeam(team.id, ecu.id);
      refreshCompetitionData();
      if (selectedEcuId === ecu.id) {
        setSelectedEcuId(null);
        setSelectedTeam(team);
      }
    } catch {
      // silently ignore
    }
  }

  async function handleSaveParticipant(data) {
    if (!participant) return;
    try {
      const updated = await updateEventParticipant(participant.id, data);
      setEventParticipants((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch {
      // silently ignore
    }
  }

  if (!selectedCompetition) {
    return (
      <>
        <CompetitionsPage onSelectCompetition={setSelectedCompetition} isDark={isDark} onToggleTheme={() => setIsDark((v) => !v)} />
        <ToastContainer position="top-right" theme="dark" />
      </>
    );
  }

  const teamIds = new Set(competitionTeams.map((t) => t.id));
  const competitionEcus = ecuList.filter((e) => e.team_id && teamIds.has(e.team_id));
  const connectedCount = competitionEcus.filter((e) => e.is_connected).length;
  const selectedEcu = competitionEcus.find((e) => e.id === selectedEcuId);
  const resolvedTeam = selectedTeam ?? competitionTeams.find((t) => t.id === selectedEcu?.team_id);

  const hasEcu = selectedTeam && competitionEcus.some((e) => e.team_id === selectedTeam.id);

  const eventTeamIds = new Set(eventParticipants.map((p) => p.team_id));
  const eventTeams = competitionTeams.filter((t) => eventTeamIds.has(t.id));
  const participant = selectedTeam
    ? (eventParticipants.find((p) => p.team_id === selectedTeam.id) ?? null)
    : null;

  return (
    <div className="app-shell">
      <Navbar
        connectedCount={connectedCount}
        totalCount={competitionEcus.length}
        competition={selectedCompetition}
        selectedEvent={selectedEvent}
        onBack={() => setSelectedCompetition(null)}
        onTogglePanel={() => { setPanelOpen((v) => !v); setUnreadCount(0); }}
        unreadCount={unreadCount}
        isDark={isDark}
        onToggleTheme={() => setIsDark((v) => !v)}
      />
      <div className="app-body">
        {!backendError && (
          <Sidebar
            events={selectedCompetition?.events ?? []}
            selectedEvent={selectedEvent}
            onSelectEvent={handleSelectEvent}
            teams={eventTeams}
            competitionTeams={competitionTeams}
            ecuList={competitionEcus}
            selectedTeamId={selectedTeam?.id}
            selectedEcuId={selectedEcuId}
            violatingEcuIds={violatingEcuIds}
            onSelectTeam={handleSelectTeam}
            onUnassignEcu={handleUnassignEcu}
            onClearTeam={() => setSelectedTeam(null)}
            onAddTeam={() => setShowAddTeam(true)}
            onRemoveTeam={handleRemoveTeam}
          />
        )}
        <main className="main-content">
          {!selectedEvent ? (
            <EventsPanel
              events={selectedCompetition?.events ?? []}
              onSelectEvent={handleSelectEvent}
            />
          ) : !selectedTeam ? (
            <LeaderboardPage
              eventId={selectedEvent.id}
              eventType={selectedEvent.event_type}
              ecuList={ecuList}
            />
          ) : selectedTeam && !hasEcu ? (
            <div className="dashboard">
              <div className="dashboard-empty">
                <svg className="empty-icon" viewBox="0 0 48 48" fill="none">
                  <rect x="4" y="14" width="40" height="24" rx="3" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 22h24M12 30h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M38 10l-4 4M10 10l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <p>No ESP32 device has been assigned for this team</p>
                <button className="btn-primary" onClick={() => setShowAssignEcu(true)}>
                  Assign ECU
                </button>
              </div>
            </div>
          ) : (
            <Dashboard
              selectedEcuId={selectedEcuId}
              teamId={resolvedTeam?.id ?? null}
              backendError={backendError}
              teamName={resolvedTeam?.name ?? null}
              onUnassign={
                resolvedTeam && selectedEcu
                  ? () => handleUnassignEcu(resolvedTeam, selectedEcu)
                  : undefined
              }
              participant={participant}
              onSaveParticipant={handleSaveParticipant}
            />
          )}
        </main>
      </div>

      {showAddTeam && (
        <AddTeamToCompetitionModal
          competition={selectedCompetition}
          competitionTeams={competitionTeams}
          onTeamAdded={handleTeamAdded}
          onClose={() => setShowAddTeam(false)}
        />
      )}

      {showAssignEcu && selectedTeam && (
        <AssignEcuModal
          team={selectedTeam}
          onAssigned={handleEcuAssigned}
          onClose={() => setShowAssignEcu(false)}
        />
      )}

      {panelOpen && (
        <NotificationPanel
          entries={violationLog}
          onClose={() => setPanelOpen(false)}
        />
      )}

      <ToastContainer position="top-right" theme="dark" autoClose={6000} />
    </div>
  );
}
