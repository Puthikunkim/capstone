import PropTypes from "prop-types";

function ecuStatus(ecu) {
  if (ecu.is_connected) return { label: "Connected", cls: "connected" };
  if (ecu.last_seen) return { label: "Lost", cls: "lost" };
  return { label: "Never seen", cls: "disconnected" };
}

function TeamCard({ team, ecu }) {
  const status = ecu ? ecuStatus(ecu) : null;
  return (
    <div className="ct-team-card">
      <div className="ct-team-top">
        <span className="ct-team-name">{team.name}</span>
        {ecu && <div className={`ecu-dot ${status.cls}`} />}
      </div>
      <div className="ct-team-meta">
        {team.vehicle_class} Class · {team.vehicle_type.charAt(0).toUpperCase() + team.vehicle_type.slice(1)}
      </div>
      {ecu ? (
        <div className="ct-team-ecu">ECU #{ecu.serial_number}</div>
      ) : (
        <div className="ct-team-no-ecu">No ECU assigned</div>
      )}
    </div>
  );
}

TeamCard.propTypes = {
  team: PropTypes.object.isRequired,
  ecu: PropTypes.object,
};

export function CompetitionTeamsPanel({ teams, ecuList, onAddTeam }) {
  return (
    <div className="ct-panel">
      <div className="ct-header">
        <div>
          <h2 className="ct-title">Teams</h2>
          <p className="ct-subtitle">
            {teams.length} team{teams.length !== 1 ? "s" : ""} in this competition
          </p>
        </div>
        <button className="btn-primary" onClick={onAddTeam}>+ Add Team</button>
      </div>

      {teams.length === 0 ? (
        <div className="ct-empty">
          <svg viewBox="0 0 48 48" fill="none" width="48" height="48">
            <circle cx="24" cy="24" r="18" stroke="currentColor" strokeWidth="2" />
            <path d="M24 16v16M16 24h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p>No teams yet</p>
          <span>Add teams to this competition to get started</span>
          <button className="btn-primary" style={{ marginTop: 8 }} onClick={onAddTeam}>
            + Add Team
          </button>
        </div>
      ) : (
        <div className="ct-grid">
          {teams.map((team) => {
            const ecu = ecuList.find((e) => e.team_id === team.id);
            return <TeamCard key={team.id} team={team} ecu={ecu} />;
          })}
        </div>
      )}
    </div>
  );
}

CompetitionTeamsPanel.propTypes = {
  teams: PropTypes.array.isRequired,
  ecuList: PropTypes.array.isRequired,
  onAddTeam: PropTypes.func.isRequired,
};
