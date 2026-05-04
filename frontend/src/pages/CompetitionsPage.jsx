import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { fetchCompetitions, createCompetition, fetchCompetitionTeams } from "../api/http";
import logo from "../assets/evolocity_logo.png";

const ALL_EVENT_TYPES = ["drag_race", "gymkhana", "endurance_efficiency"];

const EVENT_LABELS = {
  drag_race: "Drag Race",
  gymkhana: "Gymkhana",
  endurance_efficiency: "Endurance & Efficiency",
};

const EVENT_ICONS = {
  drag_race: (
    <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
      <path d="M3 8a.5.5 0 01.5-.5h7.793L9.146 5.354a.5.5 0 11.708-.708l3 3a.5.5 0 010 .708l-3 3a.5.5 0 01-.708-.708L11.293 8.5H3.5A.5.5 0 013 8z"/>
    </svg>
  ),
  gymkhana: (
    <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
      <path fillRule="evenodd" d="M8 1a7 7 0 100 14A7 7 0 008 1zM2 8a6 6 0 1112 0A6 6 0 012 8zm6-3a.5.5 0 01.5.5v2.793l1.854 1.853a.5.5 0 01-.708.708l-2-2A.5.5 0 015 8.5V5.5A.5.5 0 015.5 5H8z" clipRule="evenodd"/>
    </svg>
  ),
  endurance_efficiency: (
    <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
      <path d="M9.669.864L8 0 6.331.864l-1.85.282-.842 1.68-1.337 1.32L2.6 6l-.306 1.854 1.337 1.32.842 1.681 1.85.282L8 12l1.669-.863 1.85-.282.842-1.68 1.337-1.32L13.4 6l.306-1.854-1.337-1.32-.842-1.681L9.669.864zm1.196 1.193l.684 1.365 1.086 1.072-.25 1.506L12 6l.385 1-1.086 1.072-.684 1.365-1.51.23L8 10.422l-1.104-.755-1.51-.23L4.7 8.072 3.615 7 4 6l-.615-1-.684-1.365L3.614 2.56 5.124 2.33 8 .578l2.876 1.752 1.51.23-.521.497z"/>
    </svg>
  ),
};

function CompetitionDetailModal({ competition, onClose, onOpen }) {
  const [teams, setTeams] = useState(null);
  const [loadingTeams, setLoadingTeams] = useState(true);

  useEffect(() => {
    fetchCompetitionTeams(competition.id)
      .then(setTeams)
      .catch(() => setTeams([]))
      .finally(() => setLoadingTeams(false));
  }, [competition.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal comp-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{competition.name}</h2>
            <div className="modal-subtitle">Competition Details</div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="form-field">
            <label>Standard Event Types</label>
            <div className="comp-detail-events">
              {competition.events.map((ev) => (
                <div key={ev.id} className="comp-detail-event-row">
                  <span className="comp-detail-event-icon">{EVENT_ICONS[ev.event_type]}</span>
                  <span className="comp-detail-event-name">{EVENT_LABELS[ev.event_type] ?? ev.event_type}</span>
                </div>
              ))}
              {competition.events.length === 0 && (
                <span className="comp-event-badge muted">No events configured</span>
              )}
            </div>
          </div>

          <div className="form-field">
            <label>
              Teams&nbsp;
              <span className="comp-detail-count">
                ({loadingTeams ? "…" : (teams?.length ?? 0)})
              </span>
            </label>
            {loadingTeams ? (
              <div className="assign-ecu-loading">Loading teams…</div>
            ) : teams && teams.length > 0 ? (
              <div className="comp-detail-team-list">
                {teams.map((team) => (
                  <div key={team.id} className="comp-detail-team-row">
                    <div className="comp-detail-team-name">{team.name}</div>
                    <div className="comp-detail-team-meta">
                      {team.vehicle_class} · {team.vehicle_type}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="comp-detail-no-teams">No teams assigned to this competition yet.</p>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => { onClose(); onOpen(); }}
          >
            Open Dashboard →
          </button>
        </div>
      </div>
    </div>
  );
}

CompetitionDetailModal.propTypes = {
  competition: PropTypes.object.isRequired,
  onClose: PropTypes.func.isRequired,
  onOpen: PropTypes.func.isRequired,
};

function CompetitionCard({ competition, onSelect, onViewDetail }) {
  return (
    <div className="competition-card">
      <div className="competition-card-body" onClick={onSelect}>
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
        <button
          className="competition-card-details-btn"
          onClick={(e) => { e.stopPropagation(); onViewDetail(); }}
        >
          View Details
        </button>
        <span className="competition-card-enter" onClick={onSelect}>
          Open Dashboard →
        </span>
      </div>
    </div>
  );
}

CompetitionCard.propTypes = {
  competition: PropTypes.object.isRequired,
  onSelect: PropTypes.func.isRequired,
  onViewDetail: PropTypes.func.isRequired,
};

export function CompetitionsPage({ onSelectCompetition }) {
  const [competitions, setCompetitions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [backendError, setBackendError] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [selectedEvents, setSelectedEvents] = useState([...ALL_EVENT_TYPES]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [detailCompetition, setDetailCompetition] = useState(null);

  useEffect(() => {
    fetchCompetitions()
      .then(setCompetitions)
      .catch(() => setBackendError(true))
      .finally(() => setLoading(false));
  }, []);

  function openModal() {
    setNewName("");
    setSelectedEvents([...ALL_EVENT_TYPES]);
    setCreateError(null);
    setShowModal(true);
  }

  function closeModal() {
    if (creating) return;
    setShowModal(false);
    setCreateError(null);
  }

  function toggleEvent(type) {
    setSelectedEvents((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim() || selectedEvents.length === 0) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createCompetition(newName.trim(), selectedEvents);
      setCompetitions((prev) => [...prev, created]);
      setShowModal(false);
    } catch (err) {
      setCreateError(err.message || "Failed to create competition");
    } finally {
      setCreating(false);
    }
  }

  const canSubmit = newName.trim() && selectedEvents.length > 0 && !creating;

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
                onViewDetail={() => setDetailCompetition(comp)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── New Competition modal ───────────────────────────────── */}
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
                  <label>Event Types</label>
                  <div className="comp-creation-events">
                    {ALL_EVENT_TYPES.map((type) => {
                      const checked = selectedEvents.includes(type);
                      return (
                        <div
                          key={type}
                          className={`comp-creation-event-item${checked ? " selected" : ""}`}
                          onClick={() => toggleEvent(type)}
                        >
                          <span className="comp-creation-event-icon">{EVENT_ICONS[type]}</span>
                          <span>{EVENT_LABELS[type]}</span>
                          <span className="comp-creation-event-check">
                            {checked ? (
                              <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                                <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                              </svg>
                            ) : (
                              <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" style={{ opacity: 0.2 }}>
                                <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                              </svg>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {selectedEvents.length > 0 && (
                    <div className="comp-creation-badges">
                      {selectedEvents.map((type) => (
                        <span key={type} className="comp-event-badge">
                          {EVENT_LABELS[type]}
                        </span>
                      ))}
                    </div>
                  )}
                  {selectedEvents.length === 0 && (
                    <p className="form-field-hint" style={{ color: "var(--red)" }}>
                      Select at least one event type.
                    </p>
                  )}
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

      {/* ── Competition detail modal ────────────────────────────── */}
      {detailCompetition && (
        <CompetitionDetailModal
          competition={detailCompetition}
          onClose={() => setDetailCompetition(null)}
          onOpen={() => onSelectCompetition(detailCompetition)}
        />
      )}
    </div>
  );
}

CompetitionsPage.propTypes = {
  onSelectCompetition: PropTypes.func.isRequired,
};
