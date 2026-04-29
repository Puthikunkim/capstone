import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { TelemetryChart } from "../components/TelemetryChart";
import { useWebSocket } from "../hooks/useWebSocket";
import {
  fetchEcu,
  fetchEcuHistory,
  fetchViolations,
  configureEcu,
  uploadFirmware,
  fetchFirmwareStatus,
} from "../api/http";

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

// ── Session timer ────────────────────────────────────────────────────

function useSessionTimer(active) {
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    setSeconds(0);
    if (active) {
      intervalRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [active]);

  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// ── Dashboard ────────────────────────────────────────────────────────

export function Dashboard({ selectedEcuId, backendError }) {
  const [ecuData, setEcuData] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [violations, setViolations] = useState([]);
  const [monitoring, setMonitoring] = useState(true);

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

  const activeEcuId = monitoring ? selectedEcuId : null;
  const { isConnected, liveData } = useWebSocket(activeEcuId);
  const sessionTime = useSessionTimer(isConnected);

  // Fetch ECU details + violations when ECU changes
  useEffect(() => {
    if (!selectedEcuId) {
      setEcuData(null);
      setChartData([]);
      setViolations([]);
      return;
    }

    setChartData([]);
    setViolations([]);
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

    fetchEcuHistory(selectedEcuId)
      .then((history) =>
        setChartData([...history].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)))
      )
      .catch(() => {});

    fetchViolations(selectedEcuId)
      .then(setViolations)
      .catch(() => setViolations([]));

    fetchFirmwareStatus(selectedEcuId)
      .then(setFirmwareStatus)
      .catch(() => {});
  }, [selectedEcuId]);

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

  // Append live frames to chart, cap at 500 to prevent unbounded growth
  const MAX_CHART_POINTS = 500;
  useEffect(() => {
    if (liveData) {
      setChartData((prev) => {
        const next = [...prev, liveData];
        return next.length > MAX_CHART_POINTS ? next.slice(-MAX_CHART_POINTS) : next;
      });
    }
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
          <p>Select an ECU from the sidebar</p>
          <span>Live telemetry will appear here once connected</span>
        </div>
      </div>
    );
  }

  const teamLabel = ecuData
    ? `Team ${ecuData.team_number}`
    : `ECU ${selectedEcuId}`;

  const classLabel = ecuData?.vehicle_class ?? "--";

  const lastFrame = liveData ?? (chartData.length > 0 ? chartData[chartData.length - 1] : null);

  // Flash display — show raw KB value, or "--" if unknown
  const flashDisplay = ecuData?.flash_usage != null
    ? `${Math.round(ecuData.flash_usage / 1024)} KB`
    : "--";

  return (
    <div className="dashboard">
      {/* ── Header ── */}
      <div className="dashboard-header">
        <div className="dashboard-title-group">
          <h1>{teamLabel} Monitor</h1>
          <div className="dashboard-meta">
            <span className="meta-item">
              <svg viewBox="0 0 16 16" fill="none" className="meta-icon">
                <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
                <path d="M5 8h6M8 5v6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              Class: {classLabel}
            </span>
            <span className={`meta-item status-live ${isConnected ? "active" : ""}`} data-testid="connection-status">
              <svg viewBox="0 0 16 16" fill="none" className="meta-icon">
                <path d="M2 8c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <path d="M4.5 8c0-1.933 1.567-3.5 3.5-3.5S11.5 6.067 11.5 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <circle cx="8" cy="8" r="1.5" fill="currentColor" />
              </svg>
              Status:{" "}
              {isConnected ? "Live Data Stream" : "Disconnected"}
            </span>
            <span className="meta-item">
              <svg viewBox="0 0 16 16" fill="none" className="meta-icon">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
                <path d="M8 5v3l2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              Session Time: {sessionTime}
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

      {/* ── Stat cards ── */}
      <div className="stat-cards">
        <StatCard
          icon={
            <svg viewBox="0 0 20 20" fill="none">
              <path d="M11 2L4 11h6l-1 7 7-9h-6l1-7z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
          label="Voltage"
          value={lastFrame?.avg_voltage?.toFixed(1)}
          unit="V"
          sub={lastFrame ? <><span className="stable-dot" /> Stable</> : "No data"}
          subStyle={lastFrame ? "sub-stable" : "sub-muted"}
        />
        <StatCard
          icon={
            <svg viewBox="0 0 20 20" fill="none">
              <path d="M2 10c2-5 4-7 8-7s6 2 8 7c-2 5-4 7-8 7s-6-2-8-7z" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 7v6M7 10h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          }
          label="Current"
          value={lastFrame?.avg_current?.toFixed(1)}
          unit="A"
          sub={lastFrame ? "Bi-directional" : "No data"}
          subStyle={lastFrame ? "sub-muted" : "sub-muted"}
        />
        <StatCard
          icon={
            <svg viewBox="0 0 20 20" fill="none">
              <path d="M10 3v1M10 16v1M3 10h1M16 10h1M5.05 5.05l.7.7M14.24 14.24l.71.71M5.05 14.95l.7-.7M14.24 5.76l.71-.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          }
          label="Internal Temperature"
          value={ecuData?.temperature?.toFixed(1)}
          unit="°C"
          sub={ecuData?.temperature == null ? "No sensor data" : null}
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
          value={lastFrame?.energy != null ? lastFrame.energy.toFixed(1) : null}
          unit="Wh"
          sub={
            chartData.length > 0
              ? `${(chartData.reduce((s, f) => s + (f.energy ?? 0), 0) / chartData.length).toFixed(2)} Wh / Frame avg`
              : "No data"
          }
          subStyle="sub-muted"
        />
      </div>

      {/* ── Real-time chart ── */}
      <div className="chart-section">
        <div className="chart-section-header">
          <h3>Real-Time Energy Profiling</h3>
          <span className="chart-window-badge">Live</span>
        </div>
        {!isConnected && chartData.length === 0 ? (
          <div className="chart-empty" data-testid="chart-empty">
            <p>Waiting for data stream</p>
            <span>Chart will populate once the ECU starts sending frames</span>
          </div>
        ) : (
          <TelemetryChart data={chartData} />
        )}
      </div>

      {/* ── Bottom grid: Config + Alerts ── */}
      <div className="dashboard-bottom">
        {/* ECU Configuration */}
        <div className="config-card">
          <div className="card-header">
            <span className="card-title">ECU Configuration</span>
            <span className="card-serial">
              #{ecuData?.serial_number ?? "--"}
            </span>
          </div>

          <form className="config-form" onSubmit={handleConfigSubmit}>
            <div className="form-row">
              <div className="form-field">
                <label>ECU Serial Number</label>
                <input
                  type="text"
                  value={ecuData?.serial_number ?? ""}
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
            <div className="form-field">
              <label>Power Limit (W)</label>
              <input
                type="number"
                name="power_limit_watts"
                value={configForm.power_limit_watts}
                onChange={handleConfigChange}
                className="form-input"
                min="0"
                step="0.1"
              />
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
            <svg viewBox="0 0 20 20" fill="none" width="16" height="16" className="alerts-icon">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" fill="currentColor" />
            </svg>
            <span className="card-title">System Alerts</span>
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
  backendError: PropTypes.bool,
};
