import { useState, useEffect, useRef } from "react";
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
  fetchAlerts,
  fetchOpenViolations,
  fetchEventParticipants,
  updateEventParticipant,
} from "./api/http";
import { AddTeamToCompetitionModal } from "./components/AddTeamToCompetitionModal";
import { CompetitionTeamsPanel } from "./components/CompetitionTeamsPanel";
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
  const alertBaselineRef = useRef(null);

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

  // Reset alert baseline when competition changes
  useEffect(() => {
    alertBaselineRef.current = new Date().toISOString();
  }, [selectedCompetition]);

  // Poll for new alerts across all competition ECUs and fire toasts
  useEffect(() => {
    if (!selectedCompetition || competitionTeams.length === 0) return;

    const ecuIds = new Set(ecuList.filter((e) => {
      const teamIds = new Set(competitionTeams.map((t) => t.id));
      return e.team_id && teamIds.has(e.team_id);
    }).map((e) => e.id));

    if (ecuIds.size === 0) return;

    const poll = async () => {
      try {
        const alerts = await fetchAlerts({ start: alertBaselineRef.current, limit: 50 });
        const relevant = alerts.filter((a) => ecuIds.has(a.ecu_id));
        if (relevant.length === 0) return;

        const latest = relevant.reduce((max, a) =>
          new Date(a.timestamp) > new Date(max.timestamp) ? a : max
        );
        alertBaselineRef.current = latest.timestamp;

        relevant.forEach((alert) => {
          const ecu = ecuList.find((e) => e.id === alert.ecu_id);
          const team = competitionTeams.find((t) => t.id === ecu?.team_id);
          const label = team?.name ?? `ECU #${ecu?.serial_number ?? alert.ecu_id}`;
          toast.warning(
            `⚡ ${label}: ${alert.power_watts.toFixed(0)}W exceeded limit of ${alert.limit_watts.toFixed(0)}W`,
            { toastId: `alert-${alert.id}`, autoClose: 6000 }
          );
        });
      } catch {
        // silently ignore poll failures
      }
    };

    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [selectedCompetition, competitionTeams, ecuList]);

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
        <CompetitionsPage onSelectCompetition={setSelectedCompetition} />
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
      />
      <div className="app-body">
        {!backendError && (
          <Sidebar
            events={selectedCompetition?.events ?? []}
            selectedEvent={selectedEvent}
            onSelectEvent={handleSelectEvent}
            teams={eventTeams}
            ecuList={competitionEcus}
            selectedTeamId={selectedTeam?.id}
            selectedEcuId={selectedEcuId}
            violatingEcuIds={violatingEcuIds}
            onSelectTeam={handleSelectTeam}
            onUnassignEcu={handleUnassignEcu}
          />
        )}
        <main className="main-content">
          {!selectedEvent ? (
            <CompetitionTeamsPanel
              teams={competitionTeams}
              ecuList={competitionEcus}
              onAddTeam={() => setShowAddTeam(true)}
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

      <ToastContainer position="top-right" theme="dark" autoClose={6000} />
    </div>
  );
}
