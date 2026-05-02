import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { fetchAvailableEcus, assignEcuToTeam } from "../api/http";

export function AssignEcuModal({ team, onAssigned, onClose }) {
  const [availableEcus, setAvailableEcus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigningId, setAssigningId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchAvailableEcus()
      .then(setAvailableEcus)
      .catch(() => setAvailableEcus([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleAssign(ecu) {
    setAssigningId(ecu.id);
    setError(null);
    try {
      await assignEcuToTeam(team.id, ecu.id);
      onAssigned(ecu.id);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to assign ECU");
      setAssigningId(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Assign ECU</h2>
            <p className="modal-subtitle">
              <span className="modal-team-badge">{team.name}</span>
              {" "}— select a device to assign
            </p>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          {loading && <div className="assign-ecu-loading">Loading available ECUs…</div>}

          {!loading && availableEcus.length === 0 && (
            <div className="assign-ecu-empty">
              <svg viewBox="0 0 24 24" fill="none" width="32" height="32">
                <rect x="2" y="6" width="20" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6 10h12M6 14h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <p>No unassigned ECUs</p>
              <span>All devices are already assigned to teams</span>
            </div>
          )}

          {!loading && availableEcus.length > 0 && (
            <div className="assign-ecu-list">
              {availableEcus.map((ecu) => (
                <div key={ecu.id} className="assign-ecu-item">
                  <div className="assign-ecu-info">
                    <span className={`ecu-dot ${ecu.is_connected ? "connected" : "disconnected"}`} />
                    <div>
                      <span className="assign-ecu-serial">ECU #{ecu.serial_number}</span>
                      <span className="assign-ecu-status">
                        {ecu.is_connected ? "Connected" : "Not connected"}
                      </span>
                    </div>
                  </div>
                  <button
                    className="btn-primary"
                    onClick={() => handleAssign(ecu)}
                    disabled={assigningId !== null}
                  >
                    {assigningId === ecu.id ? "Assigning…" : "Assign"}
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && <div className="form-feedback error" style={{ marginTop: 8 }}>{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={assigningId !== null}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

AssignEcuModal.propTypes = {
  team: PropTypes.object.isRequired,
  onAssigned: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
