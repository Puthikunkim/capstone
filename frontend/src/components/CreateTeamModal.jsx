import { useState } from "react";
import PropTypes from "prop-types";
import { createTeam } from "../api/http";
import { AssignEcuModal } from "./AssignEcuModal";

const VEHICLE_CLASSES = ["Standard", "Open"];
const VEHICLE_TYPES = ["bike", "kart"];
const VEHICLE_TYPE_LABELS = { bike: "Bike", kart: "Kart" };

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
    <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
  </svg>
);

export function CreateTeamModal({ competitionId, onCreated, onClose }) {
  // ── Step 1 state ──────────────────────────────────────────────
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [vehicleClass, setVehicleClass] = useState("Standard");
  const [vehicleType, setVehicleType] = useState("bike");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  // ── Step 2 state ──────────────────────────────────────────────
  const [createdTeam, setCreatedTeam] = useState(null);

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const team = await createTeam({
        name: name.trim(),
        vehicle_class: vehicleClass,
        vehicle_type: vehicleType,
        competition_id: competitionId,
      });
      setCreatedTeam(team);
      onCreated(team, null);
      setStep(2);
    } catch (err) {
      setCreateError(err.message || "Failed to create team");
    } finally {
      setCreating(false);
    }
  }

  function handleAssigned(ecuId) {
    onCreated(createdTeam, ecuId);
  }

  function handleSkip() {
    onClose();
  }

  if (step === 2 && createdTeam) {
    return (
      <AssignEcuModal
        team={createdTeam}
        onAssigned={handleAssigned}
        onClose={handleSkip}
      />
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>

        {/* ── Step 1: Team details ───────────────────────────────── */}
        {step === 1 && (
          <>
            <div className="modal-header">
              <h2>New Team</h2>
              <button className="icon-btn" onClick={onClose}>
                <CloseIcon />
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-field">
                  <label>Team Name</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Team Alpha"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                    maxLength={128}
                  />
                </div>
                <div className="form-row">
                  <div className="form-field">
                    <label>Vehicle Class</label>
                    <select
                      className="form-input"
                      value={vehicleClass}
                      onChange={(e) => setVehicleClass(e.target.value)}
                    >
                      {VEHICLE_CLASSES.map((c) => (
                        <option key={c} value={c}>{c} Class</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label>Vehicle Type</label>
                    <select
                      className="form-input"
                      value={vehicleType}
                      onChange={(e) => setVehicleType(e.target.value)}
                    >
                      {VEHICLE_TYPES.map((t) => (
                        <option key={t} value={t}>{VEHICLE_TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {createError && (
                  <div className="form-feedback error">{createError}</div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={onClose} disabled={creating}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={creating || !name.trim()}>
                  {creating ? "Creating…" : "Create Team →"}
                </button>
              </div>
            </form>
          </>
        )}

      </div>
    </div>
  );
}

CreateTeamModal.propTypes = {
  competitionId: PropTypes.number.isRequired,
  onCreated: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
