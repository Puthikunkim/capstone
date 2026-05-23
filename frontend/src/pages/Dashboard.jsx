import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import { TelemetryChart, HistoryChart } from "../components/TelemetryChart";
import { useTeamWebSocket } from "../hooks/useWebSocket";
import {
  fetchEcu,
  fetchEcuHistory,
  fetchTeamFrames,
  fetchViolations,
  configureEcu,
  uploadFirmware,
  fetchFirmwareStatus,
} from "../api/http";

// Expand a single frame's samples into individual time-stamped points.
// The last sample gets the frame's timestamp; earlier samples are spread
// back toward prevTimestamp (or bunched at the frame timestamp if unknown).
function expandSingleFrame(frame, prevTimestamp) {
  const voltages = frame.voltage_samples ?? [];
  const currents = frame.current_samples ?? [];
  const n = Math.max(voltages.length, currents.length);
  if (n === 0) return [];

  const tEnd = new Date(frame.timestamp).getTime();
  const tStart = prevTimestamp ? new Date(prevTimestamp).getTime() : tEnd;

  return Array.from({ length: n }, (_, j) => {
    const v = voltages[j] ?? null;
    const c = currents[j] ?? null;
    return {
      timestamp: new Date(n === 1 ? tEnd : tStart + ((j + 1) / n) * (tEnd - tStart)).toISOString(),
      voltage: v,
      current: c,
      power: v != null && c != null ? v * c : null,
      // carry energy on the last sample of each frame so stat cards can display it
      energy: j === n - 1 ? (frame.energy ?? null) : undefined,
    };
  });
}

// Expand a sorted array of frames into individual sample points.
function expandFrames(frames) {
  const points = [];
  for (let i = 0; i < frames.length; i++) {
    points.push(...expandSingleFrame(frames[i], i > 0 ? frames[i - 1].timestamp : null));
  }
  return points;
}

// ── Small UI helpers ──────────────────────────────────────────────────

function StatCard({ icon, label, value, unit, sub, subStyle }) {
  return (
    <div className="stat-card">
      <div className="stat-card-header">
        <span className="stat-card-icon">{icon}</span>
        <span className="stat-card-label">{label}</span>
      </div>
      <div className="stat-card-body">
        <span className="stat-card-value">{value ?? "--"}</span>
        {unit && <span className="stat-card-unit">{unit}</span>}
      </div>
      {sub && (
        <div className={`stat-card-sub ${subStyle ?? ""}`}>{sub}</div>
      )}
    </div>
  );
}

StatCard.propTypes = {
  icon: PropTypes.node,
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  unit: PropTypes.string,
  sub: PropTypes.node,
  subStyle: PropTypes.string,
};

function AlertItem({ violation }) {
  const isPenalty = !violation.is_warning;
  const time = new Date(violation.start_timestamp).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const dur = violation.duration_seconds < 1
    ? "<1s"
    : `${violation.duration_seconds.toFixed(1)}s`;

  return (
    <div className={`alert-item ${isPenalty ? "penalty" : "warning"}`}>
      <div className="alert-item-icon">
        {isPenalty ? (
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
        )}
      </div>
      <div className="alert-item-body">
        <div className="alert-item-title">
          &ldquo;{isPenalty ? "Penalty" : "Warning"}&rdquo; Zone
        </div>
        <div className="alert-item-desc">
          {time} &mdash; Power exceeded limit for {dur}
        </div>
        {isPenalty && (
          <span className="alert-badge penalty">PENALTY APPLIED</span>
        )}
      </div>
    </div>
  );
}

AlertItem.propTypes = {
  violation: PropTypes.object.isRequired,
};

// ── Event timing card ────────────────────────────────────────────────

function toLocalInput(utcIso) {
  if (!utcIso) return "";
  const d = new Date(utcIso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EventTimingCard({ participant, onSave }) {
  const [startInput, setStartInput] = useState("");
  const [durationSec, setDurationSec] = useState("");
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    setStartInput(participant?.start ? toLocalInput(participant.start) : "");
    setDurationSec(participant?.duration_seconds != null ? String(participant.duration_seconds) : "");
  }, [participant]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const handleSave = async () => {
    if (!participant || !onSave) return;
    setSaving(true);
    try {
      await onSave({
        start: startInput ? new Date(startInput).toISOString() : null,
        duration_seconds: durationSec ? Number(durationSec) : null,
      });
    } finally {
      setSaving(false);
    }
  };

  const start = startInput ? new Date(startInput) : null;
  const durationMs = durationSec ? Number(durationSec) * 1000 : null;
  const end = start && durationMs ? new Date(start.getTime() + durationMs) : null;

  let status = null;
  let progress = 0;
  let timeDisplay = null;

  if (start && end) {
    if (now < start) {
      const diff = Math.round((start - now) / 1000);
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      timeDisplay = `Starts in ${m}:${String(s).padStart(2, "0")}`;
      status = "upcoming";
    } else if (now <= end) {
      const elapsed = (now - start) / 1000;
      const total = Number(durationSec);
      const remaining = Math.round(total - elapsed);
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      timeDisplay = `${m}:${String(s).padStart(2, "0")} remaining`;
      status = "active";
      progress = Math.min(100, (elapsed / total) * 100);
    } else {
      timeDisplay = "Event ended";
      status = "ended";
      progress = 100;
    }
  }

  return (
    <div className="event-timing-card">
      <div className="card-header">
        <span className="card-title">Event Timing</span>
        {status && (
          <span className={`event-status-badge ${status}`}>
            {status === "active" ? "In Progress" : status === "upcoming" ? "Upcoming" : "Ended"}
          </span>
        )}
      </div>
      <div className="event-timing-inputs">
        <div className="form-field">
          <label>Start Time</label>
          <input
            type="datetime-local"
            className="form-input"
            value={startInput}
            disabled={!participant}
            onChange={(e) => setStartInput(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>Duration (sec)</label>
          <input
            type="number"
            className="form-input"
            value={durationSec}
            min="1"
            placeholder="e.g. 1800"
            disabled={!participant}
            onChange={(e) => setDurationSec(e.target.value)}
          />
        </div>
      </div>
      {start && end && (
        <div className="event-timing-progress">
          <div className="event-timing-bar">
            <div className="event-timing-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className={`event-timing-label ${status}`}>{timeDisplay}</span>
        </div>
      )}
      <button
        className="btn-primary"
        style={{ marginTop: "10px", alignSelf: "flex-start" }}
        onClick={handleSave}
        disabled={!participant || saving}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

EventTimingCard.propTypes = {
  participant: PropTypes.object,
  onSave: PropTypes.func,
};

// ── Session timer ────────────────────────────────────────────────────

function useSessionTimer(active) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) return; // pause when ECU is offline — don't reset accumulated time
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// ── Dashboard ────────────────────────────────────────────────────────

export function Dashboard({ selectedEcuId, teamId, backendError, teamName, onCreateTeam, onUnassign, participant, onSaveParticipant }) {
  const [ecuData, setEcuData] = useState(null);
  const [chartData, setChartData] = useState([]);      // live sample points (capped)
  const [historyPoints, setHistoryPoints] = useState([]); // all historical sample points
  const [violations, setViolations] = useState([]);
  const [monitoring, setMonitoring] = useState(true);
  const [voltageView, setVoltageView] = useState("live");
  const [currentView, setCurrentView] = useState("live");
  const [powerView, setPowerView] = useState("live");
  const lastFrameTsRef = useRef(null); // timestamp of the last received frame

  // Config form state
  const [configForm, setConfigForm] = useState({
    team_number: "",
    vehicle_class: "",
    vehicle_type: "",
    power_limit_watts: "",
  });
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState(null);
  const [configSuccess, setConfigSuccess] = useState(false);

  // Firmware upload state
  const [firmwareFile, setFirmwareFile] = useState(null);
  const [firmwareFileError, setFirmwareFileError] = useState(null);
  const [firmwareUploading, setFirmwareUploading] = useState(false);
  const [firmwareStatus, setFirmwareStatus] = useState(null);
  const [firmwareError, setFirmwareError] = useState(null);
  const firmwareInputRef = useRef(null);

  const activeTeamId = monitoring ? teamId : null;
  const { isConnected, liveData } = useTeamWebSocket(activeTeamId);
  // ecuData.is_connected reflects whether the physical ECU is sending frames (last_seen within 10s).
  // isConnected only tells us the WebSocket to the backend is open — always true while backend runs.
  const ecuIsConnected = ecuData?.is_connected ?? false;
  const sessionTime = useSessionTimer(ecuIsConnected);

  // Fetch ECU config + violations when the selected ECU changes
  useEffect(() => {
    if (!selectedEcuId) {
      setEcuData(null);
      setViolations([]);
      return;
    }

    setConfigError(null);
    setConfigSuccess(false);
    setFirmwareStatus(null);
    setFirmwareError(null);
    setFirmwareFile(null);
    setFirmwareFileError(null);

    fetchEcu(selectedEcuId)
      .then((ecu) => {
        setEcuData(ecu);
        setConfigForm({
          team_number: ecu.team_number ?? "",
          vehicle_class: ecu.vehicle_class ?? "",
          vehicle_type: ecu.vehicle_type ?? "",
          power_limit_watts: ecu.power_limit_watts ?? "",
        });
      })
      .catch(() => setEcuData(null));

    fetchViolations(selectedEcuId)
      .then(setViolations)
      .catch(() => setViolations([]));

    fetchFirmwareStatus(selectedEcuId)
      .then(setFirmwareStatus)
      .catch(() => {});
  }, [selectedEcuId]);

  // Fetch chart data when ECU/team/participant timing changes
  useEffect(() => {
    if (!teamId || !selectedEcuId) {
      setChartData([]);
      setHistoryPoints([]);
      lastFrameTsRef.current = null;
      setVoltageView("live");
      setCurrentView("live");
      setPowerView("live");
      return;
    }

    setChartData([]);
    setHistoryPoints([]);
    lastFrameTsRef.current = null;
    setVoltageView("live");
    setCurrentView("live");
    setPowerView("live");

    const hasTimeRange = participant?.start != null && participant?.duration_seconds != null;

    if (hasTimeRange) {
      // Start+duration set: show team frames within the event time window
      fetchTeamFrames(teamId, { eventId: participant.event_id, limit: 10000 })
        .then((frames) => {
          const sorted = [...frames].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          if (sorted.length > 0) lastFrameTsRef.current = sorted[sorted.length - 1].timestamp;
          const expanded = expandFrames(sorted);
          setHistoryPoints(expanded);
          setChartData(expanded.slice(-200));
        })
        .catch(() => {});
    } else {
      // No timing: live chart seeds from last 100 ECU frames, history shows last 10 000 frames (~17 min at 10 fps)
      const livePromise = fetchEcuHistory(selectedEcuId, { limit: 100, teamId });
      const historyPromise = fetchEcuHistory(selectedEcuId, { limit: 10000, teamId });
      Promise.all([livePromise, historyPromise])
        .then(([liveFrames, allFrames]) => {
          const sortFn = (a, b) => new Date(a.timestamp) - new Date(b.timestamp);
          const sortedLive = [...liveFrames].sort(sortFn);
          const sortedAll = [...allFrames].sort(sortFn);
          if (sortedLive.length > 0) lastFrameTsRef.current = sortedLive[sortedLive.length - 1].timestamp;
          setChartData(expandFrames(sortedLive).slice(-200));
          setHistoryPoints(expandFrames(sortedAll));
        })
        .catch(() => {});
    }
  }, [teamId, selectedEcuId, participant?.start, participant?.duration_seconds]);

  // Refresh ECU metadata (temp, flash) every 5 seconds while connected
  useEffect(() => {
    if (!selectedEcuId || !isConnected) return;
    const id = setInterval(() => {
      fetchEcu(selectedEcuId)
        .then(setEcuData)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [selectedEcuId, isConnected]);

  // Expand incoming live frame into sample points and append to charts
  useEffect(() => {
    if (!liveData) return;
    const prevTs = lastFrameTsRef.current;
    lastFrameTsRef.current = liveData.timestamp;
    const newPoints = expandSingleFrame(liveData, prevTs);
    setChartData((prev) => {
      const next = [...prev, ...newPoints];
      return next.length > 200 ? next.slice(-200) : next;
    });
    setHistoryPoints((prev) => {
      const next = [...prev, ...newPoints];
      return next.length > 100000 ? next.slice(-100000) : next;
    });
  }, [liveData]);

  // ── Config form ──────────────────────────────────────────────────

  const handleConfigChange = (e) => {
    const { name, value } = e.target;
    setConfigForm((prev) => ({ ...prev, [name]: value }));
    setConfigError(null);
    setConfigSuccess(false);
  };

  const handleConfigSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      if (!selectedEcuId) return;
      setConfigSaving(true);
      setConfigError(null);
      setConfigSuccess(false);
      try {
        const payload = {};
        if (configForm.vehicle_class) payload.vehicle_class = configForm.vehicle_class;
        if (configForm.vehicle_type)  payload.vehicle_type  = configForm.vehicle_type;
        if (configForm.team_number !== "") payload.team_number = Number(configForm.team_number);
        if (configForm.power_limit_watts !== "") payload.power_limit_watts = Number(configForm.power_limit_watts);
        const updated = await configureEcu(selectedEcuId, payload);
        setEcuData(updated);
        setConfigSuccess(true);
      } catch (err) {
        setConfigError(err.message);
      } finally {
        setConfigSaving(false);
      }
    },
    [selectedEcuId, configForm]
  );

  // ── Firmware upload ──────────────────────────────────────────────

  const handleFirmwareFileChange = (e) => {
    const file = e.target.files?.[0];
    setFirmwareFileError(null);
    setFirmwareError(null);

    if (!file) {
      setFirmwareFile(null);
      return;
    }
    if (!file.name.endsWith(".bin")) {
      setFirmwareFileError("Only .bin firmware files are accepted.");
      setFirmwareFile(null);
      e.target.value = "";
      return;
    }
    setFirmwareFile(file);
  };

  const handleFirmwareUpload = useCallback(async () => {
    if (!firmwareFile || !selectedEcuId) return;
    setFirmwareUploading(true);
    setFirmwareError(null);
    try {
      const result = await uploadFirmware(selectedEcuId, firmwareFile);
      setFirmwareStatus(result);
      setFirmwareFile(null);
      if (firmwareInputRef.current) firmwareInputRef.current.value = "";
    } catch (err) {
      setFirmwareError(err.message);
    } finally {
      setFirmwareUploading(false);
    }
  }, [firmwareFile, selectedEcuId]);

  // ── Render: error state ──────────────────────────────────────────

  if (backendError) {
    return (
      <div className="dashboard">
        <div className="error-card" data-testid="backend-error">
          <div className="error-card-box">
            <svg className="error-icon" viewBox="0 0 40 40" fill="none">
              <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="2" />
              <path d="M20 12v10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="20" cy="27" r="1.5" fill="currentColor" />
            </svg>
            <h3>Cannot reach backend</h3>
            <p>
              Make sure the FastAPI server is running on port 8000, then
              refresh the page.
            </p>
            <div className="error-detail">Failed to fetch</div>
          </div>
        </div>
      </div>
    );
  }

  if (!selectedEcuId) {
    return (
      <div className="dashboard">
        <div className="dashboard-empty" data-testid="dashboard-empty">
          <svg className="empty-icon" viewBox="0 0 48 48" fill="none">
            <rect x="6" y="10" width="36" height="28" rx="4" stroke="currentColor" strokeWidth="2" />
            <path d="M16 24h16M24 16v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p>There are no teams currently associated with this competition</p>
          {onCreateTeam && (
            <button className="btn-primary" onClick={onCreateTeam}>
              + Add Team
            </button>
          )}
        </div>
      </div>
    );
  }

  const teamLabel = teamName ?? (ecuData ? `Team ${ecuData.team_number}` : `ECU ${selectedEcuId}`);

  const classLabel = ecuData?.vehicle_class ?? "--";

  const lastSample = chartData.length > 0 ? chartData[chartData.length - 1] : null;

  // Flash display — show raw KB value, or "--" if unknown
  const flashDisplay = ecuData?.flash_usage != null
    ? `${Math.round(ecuData.flash_usage / 1024)} KB`
    : "--";

  // Cumulative energy (Wh) integrated from all history points via trapezoidal rule.
  // historyPoints carries voltage + current per sample; power = V × I.
  const totalEnergyWh = useMemo(() => {
    const pts = historyPoints.filter((p) => p.voltage != null && p.current != null);
    if (pts.length < 2) return null;
    let wh = 0;
    for (let i = 1; i < pts.length; i++) {
      const dt = (new Date(pts[i].timestamp) - new Date(pts[i - 1].timestamp)) / 3_600_000;
      const avgPower = (pts[i - 1].voltage * pts[i - 1].current + pts[i].voltage * pts[i].current) / 2;
      wh += avgPower * dt;
    }
    return wh;
  }, [historyPoints]);

  return (
    <div className="dashboard">
      {/* ── Header ── */}
      <div className="dashboard-header">
        <div className="dashboard-title-group">
          <h1>{teamLabel} Monitor</h1>
          <div className="dashboard-meta">
            <span className="meta-item">
              <svg viewBox="0 0 16 16" fill="none" className="meta-icon" width="12" height="12">
                <path d="M1 10h14M3 10l1.5-4h7L13 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M1 10v2h2v-1M13 10v2h2v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <circle cx="4.5" cy="11.5" r="1" fill="currentColor" />
                <circle cx="11.5" cy="11.5" r="1" fill="currentColor" />
              </svg>
              {classLabel}
            </span>
            <span className={`meta-item status-live ${ecuIsConnected ? "active" : ""}`} data-testid="connection-status">
              <svg viewBox="0 0 16 16" fill="none" className="meta-icon" width="12" height="12">
                <path d="M2 8c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <path d="M4.5 8c0-1.933 1.567-3.5 3.5-3.5S11.5 6.067 11.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <circle cx="8" cy="8" r="1.5" fill="currentColor" />
              </svg>
              {ecuIsConnected ? "Live" : "Disconnected"}
            </span>
          </div>
        </div>
        <div className="dashboard-controls">
          <button
            className={`ctrl-btn start ${monitoring ? "active" : ""}`}
            onClick={() => setMonitoring(true)}
            disabled={monitoring}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
              <path d="M5 3.5l8 4.5-8 4.5V3.5z" />
            </svg>
            Start
          </button>
          <button
            className={`ctrl-btn stop ${!monitoring ? "active" : ""}`}
            onClick={() => setMonitoring(false)}
            disabled={!monitoring}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
              <rect x="3" y="3" width="10" height="10" rx="1" />
            </svg>
            Stop
          </button>
        </div>
      </div>

      {/* ── Event timing ── */}
      <EventTimingCard
        participant={participant ?? null}
        onSave={onSaveParticipant}
      />

      {/* ── Stat cards ── */}
      <div className="stat-cards">
        <StatCard
          icon={
            <svg viewBox="0 0 20 20" fill="none">
              <path d="M11 2L4 11h6l-1 7 7-9h-6l1-7z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
          label="Voltage"
          value={lastSample?.voltage?.toFixed(1)}
          unit="V"
          sub={lastSample ? <><span className="stable-dot" /> Stable</> : "No data"}
          subStyle={lastSample ? "sub-stable" : "sub-muted"}
        />
        <StatCard
          icon={
            <svg viewBox="0 0 20 20" fill="none">
              <path d="M2 10c2-5 4-7 8-7s6 2 8 7c-2 5-4 7-8 7s-6-2-8-7z" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 7v6M7 10h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          }
          label="Current"
          value={lastSample?.current?.toFixed(1)}
          unit="A"
          sub={lastSample ? "Bi-directional" : "No data"}
          subStyle="sub-muted"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 6v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
          label="Power"
          value={
            lastSample?.voltage != null && lastSample?.current != null
              ? (lastSample.voltage * lastSample.current).toFixed(1)
              : null
          }
          unit="W"
          sub={
            lastSample?.voltage != null && lastSample?.current != null
              ? (lastSample.voltage * lastSample.current) >= 0 ? "Discharging" : "Charging"
              : "No data"
          }
          subStyle="sub-muted"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 20 20" fill="none">
              <rect x="3" y="7" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M15 9.5h1.5a.5.5 0 010 1H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <rect x="5" y="9" width="7" height="4" rx=".75" fill="currentColor" opacity=".4" />
            </svg>
          }
          label="Energy"
          value={totalEnergyWh != null ? Math.abs(totalEnergyWh) < 1 ? (totalEnergyWh * 1000).toFixed(2) : totalEnergyWh.toFixed(3) : null}
          unit={totalEnergyWh != null && Math.abs(totalEnergyWh) < 1 ? "mWh" : "Wh"}
          sub={totalEnergyWh != null ? "Cumulative (session)" : "No data"}
          subStyle="sub-muted"
        />
      </div>

      {/* ── Real-time charts ── */}
      <div className="chart-grid">
        <div className="chart-section">
          <div className="chart-section-header">
            <h3>Voltage</h3>
            <div className="chart-view-toggle">
              <button
                className={`chart-view-btn ${voltageView === "live" ? "active" : ""}`}
                onClick={() => setVoltageView("live")}
              >
                Live
              </button>
              <button
                className={`chart-view-btn ${voltageView === "history" ? "active" : ""}`}
                onClick={() => setVoltageView("history")}
              >
                History
              </button>
            </div>
          </div>
          {voltageView === "live" ? (
            !isConnected && chartData.length === 0 ? (
              <div className="chart-empty" data-testid="chart-empty">
                <p>Waiting for data stream</p>
                <span>Start monitoring to see live data</span>
              </div>
            ) : (
              <TelemetryChart
                data={chartData}
                dataKey="voltage"
                color="#00c6ff"
                unit="V"
                label="Voltage"
              />
            )
          ) : (
            <HistoryChart
              data={historyPoints}
              dataKey="voltage"
              color="#00c6ff"
              unit="V"
              label="Voltage"
            />
          )}
        </div>

        <div className="chart-section">
          <div className="chart-section-header">
            <h3>Current</h3>
            <div className="chart-view-toggle">
              <button
                className={`chart-view-btn ${currentView === "live" ? "active" : ""}`}
                onClick={() => setCurrentView("live")}
              >
                Live
              </button>
              <button
                className={`chart-view-btn ${currentView === "history" ? "active" : ""}`}
                onClick={() => setCurrentView("history")}
              >
                History
              </button>
            </div>
          </div>
          {currentView === "live" ? (
            !isConnected && chartData.length === 0 ? (
              <div className="chart-empty">
                <p>Waiting for data stream</p>
                <span>Start monitoring to see live data</span>
              </div>
            ) : (
              <TelemetryChart
                data={chartData}
                dataKey="current"
                color="#f59e0b"
                unit="A"
                label="Current"
              />
            )
          ) : (
            <HistoryChart
              data={historyPoints}
              dataKey="current"
              color="#f59e0b"
              unit="A"
              label="Current"
            />
          )}
        </div>

        <div className="chart-section">
          <div className="chart-section-header">
            <h3>Power</h3>
            <div className="chart-view-toggle">
              <button
                className={`chart-view-btn ${powerView === "live" ? "active" : ""}`}
                onClick={() => setPowerView("live")}
              >
                Live
              </button>
              <button
                className={`chart-view-btn ${powerView === "history" ? "active" : ""}`}
                onClick={() => setPowerView("history")}
              >
                History
              </button>
            </div>
          </div>
          {powerView === "live" ? (
            !isConnected && chartData.length === 0 ? (
              <div className="chart-empty">
                <p>Waiting for data stream</p>
                <span>Start monitoring to see live data</span>
              </div>
            ) : (
              <TelemetryChart
                data={chartData}
                dataKey="power"
                color="#10b981"
                unit="W"
                label="Power"
              />
            )
          ) : (
            <HistoryChart
              data={historyPoints}
              dataKey="power"
              color="#10b981"
              unit="W"
              label="Power"
            />
          )}
        </div>
      </div>

      {/* ── Bottom grid: Config + Alerts ── */}
      <div className="dashboard-bottom">
        {/* ECU Configuration */}
        <div className="config-card">
          <div className="card-header">
            <span className="card-title">ECU Configuration</span>
            <div className="card-header-right">
              <span className="card-serial">ECU #{ecuData?.id ?? "--"}</span>
              {onUnassign && (
                <button className="btn-unassign" onClick={onUnassign} title="Unassign ECU from team">
                  Unassign ECU
                </button>
              )}
            </div>
          </div>

          <form className="config-form" onSubmit={handleConfigSubmit}>
            <div className="form-row">
              <div className="form-field">
                <label>ECU ID</label>
                <input
                  type="text"
                  value={ecuData?.id ?? ""}
                  readOnly
                  className="form-input readonly"
                />
              </div>
              <div className="form-field">
                <label>MAC Address</label>
                <input
                  type="text"
                  value={ecuData?.mac_address ?? ""}
                  readOnly
                  className="form-input readonly"
                />
              </div>
              <div className="form-field">
                <label>Vehicle Class</label>
                <select
                  name="vehicle_class"
                  value={configForm.vehicle_class}
                  onChange={handleConfigChange}
                  className="form-input"
                >
                  <option value="">Select class</option>
                  <option value="Standard">Standard Class (350W)</option>
                  <option value="Open">Open Class (2kW)</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-field">
                <label>Vehicle Type</label>
                <select
                  name="vehicle_type"
                  value={configForm.vehicle_type}
                  onChange={handleConfigChange}
                  className="form-input"
                >
                  <option value="">Select type</option>
                  <option value="bike">Bike</option>
                  <option value="kart">Kart</option>
                </select>
              </div>
              <div className="form-field">
                <label>Team Number</label>
                <input
                  type="number"
                  name="team_number"
                  value={configForm.team_number}
                  onChange={handleConfigChange}
                  className="form-input"
                  min="0"
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-field">
                <label>Power Limit (W)</label>
                <input
                  type="number"
                  name="power_limit_watts"
                  value={configForm.power_limit_watts}
                  onChange={handleConfigChange}
                  className="form-input"
                  min="1"
                  step="any"
                  placeholder="e.g. 350"
                />
              </div>
            </div>


            {configError && (
              <div className="form-feedback error">{configError}</div>
            )}
            {configSuccess && (
              <div className="form-feedback success">
                Configuration saved successfully
              </div>
            )}

            <button
              type="submit"
              className="btn-primary full-width"
              disabled={configSaving || !selectedEcuId}
            >
              {configSaving ? "Saving…" : "Sync Configuration to ECU"}
            </button>
          </form>

          {/* Firmware Upload */}
          <div className="firmware-section">
            <div className="firmware-header">
              <span className="card-title">Firmware Update</span>
              {firmwareStatus && (
                <span className={`firmware-status-badge ${firmwareStatus.status}`}>
                  {firmwareStatus.status}
                </span>
              )}
            </div>

            <div className="firmware-upload-row">
              <label className="file-input-label">
                <input
                  ref={firmwareInputRef}
                  type="file"
                  accept=".bin"
                  onChange={handleFirmwareFileChange}
                  className="file-input-hidden"
                />
                <span className="file-input-text">
                  {firmwareFile ? firmwareFile.name : "Choose .bin file…"}
                </span>
                <span className="file-input-btn">Browse</span>
              </label>
              <button
                className="btn-primary"
                onClick={handleFirmwareUpload}
                disabled={!firmwareFile || firmwareUploading}
              >
                {firmwareUploading ? "Uploading…" : "Upload"}
              </button>
            </div>

            {firmwareFileError && (
              <div className="form-feedback error">{firmwareFileError}</div>
            )}
            {firmwareError && (
              <div className="form-feedback error">{firmwareError}</div>
            )}
            {firmwareStatus?.filename && (
              <div className="firmware-info">
                <span>Last: {firmwareStatus.filename}</span>
                {firmwareStatus.progress > 0 && firmwareStatus.progress < 100 && (
                  <div className="firmware-progress-bar">
                    <div
                      className="firmware-progress-fill"
                      style={{ width: `${firmwareStatus.progress}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flash-row">
              <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
                <rect x="2" y="4" width="12" height="8" rx="1" stroke="currentColor" strokeWidth="1.3" />
                <path d="M5 4V3M11 4V3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              <span>Flash memory usage: {flashDisplay}</span>
            </div>
          </div>
        </div>

        {/* System Alerts */}
        <div className="alerts-card">
          <div className="card-header">
            <span className="card-title">System Alerts</span>
            <svg viewBox="0 0 20 20" fill="none" width="16" height="16" className="alerts-icon">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" fill="currentColor" />
            </svg>
          </div>

          <div className="alerts-list">
            {violations.length === 0 ? (
              <div className="alerts-empty" data-testid="alerts-empty">
                <p>No alerts recorded</p>
                <span>Power violations will appear here</span>
              </div>
            ) : (
              violations.map((v) => <AlertItem key={v.id} violation={v} />)
            )}

            {monitoring && !isConnected && ecuData && (
              <div className="alert-item connection-lost">
                <div className="alert-item-icon">
                  <svg viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.029 10.029 0 003.3-4.38 1.651 1.651 0 000-1.185A10.004 10.004 0 009.999 3a9.956 9.956 0 00-4.744 1.194L3.28 2.22zM7.752 6.69l1.092 1.092a2.5 2.5 0 013.374 3.373l1.091 1.091a4 4 0 00-5.557-5.556z" clipRule="evenodd" />
                    <path d="M10.748 13.93l2.523 2.523a9.987 9.987 0 01-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 010-1.186A10.007 10.007 0 012.839 6.02L6.07 9.252a4 4 0 004.678 4.678z" />
                  </svg>
                </div>
                <div className="alert-item-body">
                  <div className="alert-item-title">Connection Lost</div>
                  <div className="alert-item-desc">
                    ECU is not currently streaming data
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

Dashboard.propTypes = {
  selectedEcuId: PropTypes.number,
  teamId: PropTypes.number,
  backendError: PropTypes.bool,
  teamName: PropTypes.string,
  onCreateTeam: PropTypes.func,
  onUnassign: PropTypes.func,
  participant: PropTypes.object,
  onSaveParticipant: PropTypes.func,
};
