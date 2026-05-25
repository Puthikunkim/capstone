import { useState } from "react";
import PropTypes from "prop-types";

const EVENT_LABELS = {
  drag_race: "Drag Race",
  gymkhana: "Gymkhana",
  endurance_efficiency: "Endurance & Efficiency",
};

function ecuStatus(ecu) {
  return ecu.is_connected ? "connected" : "disconnected";
}

function FlashIndicator({ flashUsage }) {
  if (flashUsage == null) return null;
  const kb = Math.round(flashUsage / 1024);
  return (
    <span className="ecu-flash-value">
      <svg viewBox="0 0 12 12" fill="none" width="10" height="10">
        <rect x="1" y="3" width="10" height="6" rx=".75" stroke="currentColor" strokeWidth="1.1" />
        <path d="M3.5 3V2.5M8.5 3V2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
      {kb} KB
    </span>
  );
}
FlashIndicator.propTypes = { flashUsage: PropTypes.number };

function TeamCard({ team, ecu, isActive, onSelect }) {
  const dotClass = ecu ? ecuStatus(ecu) : "disconnected";
  return (
    <div
      className={`sidebar-team-card ${isActive ? "active" : ""} ${!ecu ? "no-ecu" : ""}`}
      onClick={onSelect}
    >
      <div className="team-card-top">
        <span className="team-card-name">{team.name}</span>
        {ecu && <div className={`ecu-dot ${dotClass}`} />}
      </div>
      <div className="team-card-meta">
        {team.vehicle_class} Class · {team.vehicle_type.charAt(0).toUpperCase() + team.vehicle_type.slice(1)}
      </div>
      {ecu ? (
        <div className="team-card-ecu">
          <span>{ecu.mac_address ?? "—"}</span>
          <FlashIndicator flashUsage={ecu.flash_usage} />
        </div>
      ) : (
        <div className="team-card-no-ecu">No ECU assigned</div>
      )}
    </div>
  );
}

TeamCard.propTypes = {
  team: PropTypes.object.isRequired,
  ecu: PropTypes.object,
  isActive: PropTypes.bool,
  onSelect: PropTypes.func.isRequired,
};

export function Sidebar({
  selectedEvent,
  onSelectEvent,
  teams,
  competitionTeams,
  ecuList,
  selectedTeamId,
  selectedEcuId,
  violatingEcuIds,
  onSelectTeam,
  onUnassignEcu,
  onClearTeam,
  onAddTeam,
  onRemoveTeam,
}) {
  const [query, setQuery] = useState("");

  // ── Teams list view (no event selected) ──────────────────────────
  if (!selectedEvent) {
    return (
      <aside className="sidebar">
        <div className="sidebar-section-label">
          Teams
          {onAddTeam && (
            <button className="sidebar-add-btn" onClick={onAddTeam} title="Add team">
              <svg viewBox="0 0 12 12" fill="none" width="10" height="10">
                <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <div className="sidebar-ecu-list">
          {(competitionTeams ?? []).length === 0 ? (
            <div className="sidebar-empty">No teams yet</div>
          ) : (
            (competitionTeams ?? []).map((team) => {
              const ecu = ecuList.find((e) => e.team_id === team.id);
              const dotClass = ecu ? ecuStatus(ecu) : null;
              return (
                <div key={team.id} className="sidebar-team-card" style={{ cursor: "default" }}>
                  <div className="team-card-top">
                    <span className="team-card-name">{team.name}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {ecu && <div className={`ecu-dot ${dotClass}`} />}
                      {onRemoveTeam && (
                        <button
                          className="ct-remove-btn"
                          onClick={() => onRemoveTeam(team)}
                          title="Remove from competition"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="team-card-meta">
                    {team.vehicle_class} · {team.vehicle_type?.charAt(0).toUpperCase() + (team.vehicle_type?.slice(1) ?? "")}
                  </div>
                  {ecu ? (
                    <div className="team-card-ecu">
                      <span>{ecu.mac_address ?? "—"}</span>
                    </div>
                  ) : (
                    <div className="team-card-no-ecu">No ECU assigned</div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </aside>
    );
  }

  // ── Teams list view (event selected) ─────────────────────────────
  const q = query.toLowerCase();
  const filteredTeams = (teams ?? []).filter((team) => {
    if (!q) return true;
    if (team.name.toLowerCase().includes(q)) return true;
    const ecu = ecuList.find((e) => e.team_id === team.id);
    return ecu ? (ecu.mac_address ?? "").toLowerCase().includes(q) : false;
  });

  return (
    <aside className="sidebar">
      <div className="sidebar-search">
        <button className="sidebar-back-btn" onClick={() => onSelectEvent(null)}>
          <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {EVENT_LABELS[selectedEvent.event_type] ?? selectedEvent.event_type}
        </button>
        {selectedTeamId && onClearTeam && (
          <button className="sidebar-back-btn" onClick={onClearTeam}>
            <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Leaderboard
          </button>
        )}
      </div>

      <div className="sidebar-search" style={{ paddingTop: 0 }}>
        <div className="search-input-wrap">
          <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Find team or ECU…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="sidebar-section-label">Teams</div>

      <div className="sidebar-ecu-list">
        {(teams ?? []).length === 0 && (
          <div className="sidebar-empty">No teams in this competition</div>
        )}
        {(teams ?? []).length > 0 && filteredTeams.length === 0 && (
          <div className="sidebar-empty">No results for &ldquo;{query}&rdquo;</div>
        )}
        {filteredTeams.map((team) => {
          const ecu = ecuList.find((e) => e.team_id === team.id);
          const isActive = ecu ? selectedEcuId === ecu.id : selectedTeamId === team.id;
          return (
            <TeamCard
              key={team.id}
              team={team}
              ecu={ecu}
              isActive={isActive}
              onSelect={() => onSelectTeam(team)}
              onUnassign={() => onUnassignEcu && onUnassignEcu(team, ecu)}
            />
          );
        })}
      </div>
    </aside>
  );
}

Sidebar.propTypes = {
  selectedEvent: PropTypes.object,
  onSelectEvent: PropTypes.func.isRequired,
  teams: PropTypes.array,
  competitionTeams: PropTypes.array,
  ecuList: PropTypes.array.isRequired,
  selectedTeamId: PropTypes.number,
  selectedEcuId: PropTypes.number,
  violatingEcuIds: PropTypes.instanceOf(Set),
  onSelectTeam: PropTypes.func.isRequired,
  onUnassignEcu: PropTypes.func,
  onClearTeam: PropTypes.func,
  onAddTeam: PropTypes.func,
  onRemoveTeam: PropTypes.func,
};
