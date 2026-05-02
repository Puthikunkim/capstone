import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { fetchCompetitions, createCompetition } from "../api/http";
import logo from "../assets/evolocity_logo.png";

const ALL_EVENT_TYPES = ["drag_race", "gymkhana", "endurance_efficiency"];

const EVENT_LABELS = {
  drag_race: "Drag Race",
  gymkhana: "Gymkhana",
  endurance_efficiency: "Endurance & Efficiency",
};

function CompetitionCard({ competition, onSelect }) {
  return (
    <div className="competition-card" onClick={onSelect}>
      <div className="competition-card-body">
        <div className="competition-card-name">{competition.name}</div>
        <div className="competition-card-events">
          {competition.events.length === 0 ? (
            <span className="comp-event-badge muted">No events configured</span>
          ) : (
            competition.events.map((ev) => (
              <span key={ev.id} className="comp-event-badge">
                {EVENT_LABELS[ev.event_type] ?? ev.event_type}
              </span>
            ))
          )}
        </div>
      </div>
      <div className="competition-card-footer">
        <span className="competition-card-enter">Open Dashboard →</span>
      </div>
    </div>
  );
}

CompetitionCard.propTypes = {
  competition: PropTypes.object.isRequired,
  onSelect: PropTypes.func.isRequired,
};

export function CompetitionsPage({ onSelectCompetition }) {
  const [competitions, setCompetitions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [backendError, setBackendError] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [selectedEvent, setSelectedEvent] = useState(ALL_EVENT_TYPES[0]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  useEffect(() => {
    fetchCompetitions()
      .then(setCompetitions)
      .catch(() => setBackendError(true))
      .finally(() => setLoading(false));
  }, []);

  function openModal() {
    setNewName("");
    setSelectedEvent(ALL_EVENT_TYPES[0]);
    setCreateError(null);
    setShowModal(true);
  }

  function closeModal() {
    if (creating) return;
    setShowModal(false);
    setCreateError(null);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createCompetition(newName.trim(), [selectedEvent]);
      setCompetitions((prev) => [...prev, created]);
      setShowModal(false);
    } catch (err) {
      setCreateError(err.message || "Failed to create competition");
    } finally {
      setCreating(false);
    }
  }

  const canSubmit = newName.trim() && !creating;

  return (
    <div className="competitions-page">
      <nav className="competitions-topbar">
        <img src={logo} alt="EVolocity" className="navbar-logo-img" />
        <button className="btn-primary" onClick={openModal}>
          + New Competition
        </button>
      </nav>

      <div className="competitions-content">
        <div className="competitions-heading">
          <h1>Competitions</h1>
          <p>Select a competition to open its live dashboard</p>
        </div>

        {loading && <div className="loading-state">Loading…</div>}

        {backendError && (
          <div className="competitions-backend-error">
            <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
            </svg>
            <div>
              <p>Cannot reach backend</p>
              <span>Make sure the FastAPI server is running on port 8000</span>
            </div>
          </div>
        )}

        {!loading && !backendError && competitions.length === 0 && (
          <div className="competitions-empty">
            <svg viewBox="0 0 48 48" fill="none" width="48" height="48">
              <rect x="6" y="10" width="36" height="28" rx="4" stroke="currentColor" strokeWidth="2" />
              <path d="M16 10V8a2 2 0 012-2h12a2 2 0 012 2v2" stroke="currentColor" strokeWidth="2" />
              <path d="M24 20v8M20 24h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <p>No competitions yet</p>
            <span>Create your first competition to get started</span>
            <button className="btn-primary" onClick={openModal}>
              + New Competition
            </button>
          </div>
        )}

        {!loading && !backendError && competitions.length > 0 && (
          <div className="competitions-grid">
            {competitions.map((comp) => (
              <CompetitionCard
                key={comp.id}
                competition={comp}
                onSelect={() => onSelectCompetition(comp)}
              />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>New Competition</h2>
              <button className="icon-btn" onClick={closeModal}>
                <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                  <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-field">
                  <label>Competition Name</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Round 1 – 2026"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    autoFocus
                    maxLength={128}
                  />
                </div>

                <div className="form-field">
                  <label>Event Type</label>
                  <div className="event-type-checks">
                    {ALL_EVENT_TYPES.map((type) => (
                      <label key={type} className={`event-check-item ${selectedEvent === type ? "checked" : ""}`}>
                        <input
                          type="radio"
                          name="event_type"
                          value={type}
                          checked={selectedEvent === type}
                          onChange={() => setSelectedEvent(type)}
                        />
                        <span>{EVENT_LABELS[type]}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {createError && (
                  <div className="form-feedback error">{createError}</div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={closeModal} disabled={creating}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={!canSubmit}>
                  {creating ? "Creating…" : "Create Competition"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

CompetitionsPage.propTypes = {
  onSelectCompetition: PropTypes.func.isRequired,
};
