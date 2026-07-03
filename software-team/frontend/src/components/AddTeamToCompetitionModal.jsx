import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { fetchTeams, addTeamToCompetition } from "../api/http";
import { CreateTeamModal } from "./CreateTeamModal";

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
    <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
  </svg>
);

export function AddTeamToCompetitionModal({ competition, competitionTeams, onTeamAdded, onClose }) {
  const [allTeams, setAllTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState(null);
  const [addedIds, setAddedIds] = useState(new Set());
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const addedOnceRef = useRef(false);

  const competitionTeamIds = new Set(competitionTeams.map((t) => t.id));

  useEffect(() => {
    fetchTeams()
      .then(setAllTeams)
      .catch(() => setAllTeams([]))
      .finally(() => setLoading(false));
  }, []);

  const available = allTeams.filter(
    (t) => !competitionTeamIds.has(t.id) && !addedIds.has(t.id) && !t.competition_id
  );
  const filtered = query
    ? available.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
    : available;

  async function handleAdd(teamId) {
    setAddingId(teamId);
    setError(null);
    try {
      const updated = await addTeamToCompetition(competition.id, teamId);
      setAddedIds((prev) => new Set([...prev, teamId]));
      onTeamAdded(updated);
    } catch (err) {
      setError(err.message || "Failed to add team");
    } finally {
      setAddingId(null);
    }
  }

  async function handleNewTeamCreated(team) {
    if (addedOnceRef.current) return;
    addedOnceRef.current = true;
    setAllTeams((prev) => [...prev, team]);
    try {
      const updated = await addTeamToCompetition(competition.id, team.id);
      setAddedIds((prev) => new Set([...prev, team.id]));
      onTeamAdded(updated);
    } catch (err) {
      setError(err.message || "Failed to add new team to competition");
    }
  }

  function handleCreateClose() {
    addedOnceRef.current = false;
    setShowCreate(false);
  }

  if (showCreate) {
    return (
      <CreateTeamModal
        onCreated={handleNewTeamCreated}
        onClose={handleCreateClose}
      />
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Add Teams</h2>
            <div className="modal-subtitle">to {competition.name}</div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-field">
            <input
              type="text"
              className="form-input"
              placeholder="Search teams…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="assign-ecu-loading">Loading teams…</div>
          ) : available.length === 0 ? (
            <div className="assign-ecu-empty">
              <p>All teams are already in this competition</p>
              <span>Create a new team to add one</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="assign-ecu-loading">No teams match &ldquo;{query}&rdquo;</div>
          ) : (
            <div className="add-team-list">
              {filtered.map((team) => (
                <div key={team.id} className="add-team-row">
                  <div className="add-team-info">
                    <span className="add-team-name">{team.name}</span>
                    <span className="add-team-meta">
                      {team.vehicle_class} · {team.vehicle_type}
                      {team.competition_id ? " · Currently in another competition" : ""}
                    </span>
                  </div>
                  <button
                    className="btn-primary add-team-btn"
                    onClick={() => handleAdd(team.id)}
                    disabled={addingId === team.id}
                  >
                    {addingId === team.id ? "Adding…" : "Add"}
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && <div className="form-feedback error">{error}</div>}
        </div>

        <div className="modal-footer add-team-footer">
          <button className="btn-secondary" onClick={() => setShowCreate(true)}>
            + Create New Team
          </button>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

AddTeamToCompetitionModal.propTypes = {
  competition: PropTypes.object.isRequired,
  competitionTeams: PropTypes.array.isRequired,
  onTeamAdded: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
