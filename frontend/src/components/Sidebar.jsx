import { useState } from "react";
import PropTypes from "prop-types";

function ecuStatus(ecu) {
  if (ecu.is_connected) return "connected";
  if (ecu.last_seen) return "lost";
  return "disconnected";
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

// Flat team card — one ECU per team
function TeamCard({ team, ecu, isActive, isViolating, onSelect }) {
  const status = ecu ? ecuStatus(ecu) : "disconnected";
  const dotClass = isViolating ? "violation" : status;
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
          <span>ECU #{ecu.serial_number}</span>
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
  isViolating: PropTypes.bool,
  onSelect: PropTypes.func.isRequired,
};

export function Sidebar({ teams, ecuList, selectedTeamId, selectedEcuId, violatingEcuIds, onSelectTeam, onUnassignEcu, onCreateTeam }) {
  const [query, setQuery] = useState("");

  const isGrouped = teams != null;

  const q = query.toLowerCase();

  const filteredTeams = isGrouped
    ? teams.filter((team) => {
        if (!q) return true;
        if (team.name.toLowerCase().includes(q)) return true;
        const ecu = ecuList.find((e) => e.team_id === team.id);
        return ecu ? String(ecu.serial_number).includes(q) : false;
      })
    : [];

  const flatFiltered = !isGrouped
    ? ecuList.filter((ecu) =>
        `team ${ecu.team_number}`.toLowerCase().includes(q) ||
        String(ecu.serial_number ?? "").includes(q)
      )
    : [];

  return (
    <aside className="sidebar">
      <div className="sidebar-search">
        <div className="search-input-wrap">
          <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder={isGrouped ? "Find team or ECU…" : "Find ECU or Team…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="sidebar-section-label">
        Teams
        {isGrouped && onCreateTeam && (
          <button className="sidebar-add-btn" onClick={onCreateTeam} title="Add team">
            <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
              <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <div className="sidebar-ecu-list">
        {isGrouped ? (
          <>
            {teams.length === 0 && (
              <div className="sidebar-empty">No teams in this competition</div>
            )}
            {teams.length > 0 && filteredTeams.length === 0 && (
              <div className="sidebar-empty">No results for &ldquo;{query}&rdquo;</div>
            )}
            {filteredTeams.map((team) => {
              const ecu = ecuList.find((e) => e.team_id === team.id);
              const isActive = ecu ? selectedEcuId === ecu.id : selectedTeamId === team.id;
              const isViolating = ecu ? (violatingEcuIds ?? new Set()).has(ecu.id) : false;
              return (
                <TeamCard
                  key={team.id}
                  team={team}
                  ecu={ecu}
                  isActive={isActive}
                  isViolating={isViolating}
                  onSelect={() => onSelectTeam(team)}
                  onUnassign={() => onUnassignEcu && onUnassignEcu(team, ecu)}
                />
              );
            })}
          </>
        ) : (
          <>
            {ecuList.length === 0 && (
              <div className="sidebar-empty">No ECUs registered</div>
            )}
            {ecuList.length > 0 && flatFiltered.length === 0 && (
              <div className="sidebar-empty">No results for &ldquo;{query}&rdquo;</div>
            )}
            {flatFiltered.map((ecu) => {
              const status = ecuStatus(ecu);
              const isActive = selectedEcuId === ecu.id;
              return (
                <div
                  key={ecu.id}
                  className={`sidebar-ecu-item ${isActive ? "active" : ""} status-${status}`}

                >
                  <div className="ecu-item-main">
                    <div className="ecu-item-info">
                      <span className="ecu-item-name">Team {ecu.team_number}</span>
                      <span className="ecu-item-class">{ecu.vehicle_class} Class</span>
                      {status === "lost" && <span className="ecu-item-sublabel">Connection Lost</span>}
                    </div>
                    <div className="ecu-item-right">
                      <div className={`ecu-dot ${status}`} />
                      <FlashIndicator flashUsage={ecu.flash_usage} />
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}

Sidebar.propTypes = {
  teams: PropTypes.array,
  ecuList: PropTypes.array.isRequired,
  selectedTeamId: PropTypes.number,
  selectedEcuId: PropTypes.number,
  violatingEcuIds: PropTypes.instanceOf(Set),
  onSelectTeam: PropTypes.func.isRequired,
  onUnassignEcu: PropTypes.func,
  onCreateTeam: PropTypes.func,
};
