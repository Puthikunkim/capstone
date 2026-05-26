import { useState, useEffect, useRef, useMemo } from "react";
import PropTypes from "prop-types";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import WebSocketClient from "../api/websocket";
import { fetchViolations } from "../api/http";

const TEAM_COLORS = [
  "#00c6ff", "#f59e0b", "#a78bfa", "#f87171", "#34d399",
  "#fb923c", "#60a5fa", "#e879f9", "#facc15", "#4ade80",
];

// ── Frame expansion (mirrors Dashboard.jsx) ──────────────────────────────────
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
      timestamp: new Date(
        n === 1 ? tEnd : tStart + ((j + 1) / n) * (tEnd - tStart),
      ).toISOString(),
      voltage: v,
      current: c,
      power: v != null && c != null ? v * c : null,
    };
  });
}

// Keys used in Recharts data objects. String keys avoid Recharts quirks with numeric dataKeys.
const teamKey = (teamId) => `t_${teamId}`;

// ── Merge per-team data into a single Recharts-compatible array ───────────────

// Live: one pass for all 3 channels, index-aligned using each team's last maxPts points.
function mergeAllForLiveChart(chartDataByTeam, selectedTeamIds, maxPts = 200) {
  if (selectedTeamIds.length === 0) return { voltage: [], current: [], power: [] };

  const slices = {};
  let newestMs = 0;
  let maxLen = 0;
  for (const teamId of selectedTeamIds) {
    const pts = (chartDataByTeam[teamId] ?? []).slice(-maxPts);
    slices[teamId] = pts;
    if (pts.length > maxLen) maxLen = pts.length;
    if (pts.length > 0) {
      const t = new Date(pts[pts.length - 1].timestamp).getTime();
      if (t > newestMs) newestMs = t;
    }
  }
  if (maxLen === 0) return { voltage: [], current: [], power: [] };

  const voltage = [], current = [], power = [];
  for (let i = 0; i < maxLen; i++) {
    const vEntry = {}, cEntry = {}, pEntry = {};
    let label = "";
    let labelSet = false;
    for (const teamId of selectedTeamIds) {
      const pts = slices[teamId];
      const offset = pts.length - maxLen;
      const p = offset + i >= 0 ? pts[offset + i] : null;
      const key = teamKey(teamId);
      vEntry[key] = p?.voltage ?? null;
      cEntry[key] = p?.current ?? null;
      pEntry[key] = p?.power   ?? null;
      if (!labelSet && p) {
        const diffMs = newestMs - new Date(p.timestamp).getTime();
        if (i === maxLen - 1) label = "Now";
        else if (diffMs >= 60000) label = `-${Math.floor(diffMs / 60000)}m${Math.round((diffMs % 60000) / 1000)}s`;
        else label = `-${Math.round(diffMs / 1000)}s`;
        labelSet = true;
      }
    }
    vEntry.timeLabel = cEntry.timeLabel = pEntry.timeLabel = label;
    voltage.push(vEntry);
    current.push(cEntry);
    power.push(pEntry);
  }
  return { voltage, current, power };
}

// ── Multi-team chart ──────────────────────────────────────────────────────────
const TOOLTIP_CONTENT_STYLE = {
  background: "#111827", border: "1px solid #1e2a3a",
  borderRadius: 8, fontSize: 12,
};

function MultiTeamChart({ mergedData, selectedTeamIds, teamColors, teamNames, unit }) {
  if (selectedTeamIds.length === 0) {
    return (
      <div className="chart-empty">
        <p>No teams selected</p>
        <span>Select at least one team above</span>
      </div>
    );
  }
  if (mergedData.length === 0) {
    return (
      <div className="chart-empty">
        <p>Waiting for data stream</p>
        <span>Start monitoring to see live data</span>
      </div>
    );
  }

  let minVal = Infinity, maxVal = -Infinity;
  for (const d of mergedData) {
    for (const id of selectedTeamIds) {
      const v = d[teamKey(id)];
      if (v != null) {
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
    }
  }
  const min = Number.isFinite(minVal) ? minVal : 0;
  const max = Number.isFinite(maxVal) ? maxVal : 1;
  const pad = Math.max(max - min, 1) * 0.3;
  const domain = [
    Number.parseFloat((min - pad).toFixed(2)),
    Number.parseFloat((max + pad).toFixed(2)),
  ];

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={mergedData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="timeLabel"
          tick={{ fill: "#6b7a99", fontSize: 11 }}
          axisLine={{ stroke: "#1e2a3a" }}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={60}
        />
        <YAxis
          domain={domain}
          unit={unit}
          tick={{ fill: "#6b7a99", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={52}
        />
        <Tooltip
          contentStyle={TOOLTIP_CONTENT_STYLE}
          labelStyle={{ color: "#e8edf5" }}
          itemStyle={{ color: "#e8edf5" }}
          formatter={(v, name) => {
            const teamId = Number(name.replace("t_", ""));
            return [
              v != null ? `${Number(v).toFixed(2)} ${unit}` : "—",
              teamNames[teamId] ?? name,
            ];
          }}
        />
        <Legend
          formatter={(name) => {
            const teamId = Number(name.replace("t_", ""));
            return teamNames[teamId] ?? name;
          }}
          wrapperStyle={{ fontSize: 12, color: "#6b7a99" }}
        />
        {selectedTeamIds.map((teamId) => (
          <Line
            key={teamId}
            type="monotone"
            dataKey={teamKey(teamId)}
            stroke={teamColors[teamId]}
            dot={false}
            isAnimationActive={false}
            strokeWidth={2}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

MultiTeamChart.propTypes = {
  mergedData:      PropTypes.array.isRequired,
  selectedTeamIds: PropTypes.array.isRequired,
  teamColors:      PropTypes.object.isRequired,
  teamNames:       PropTypes.object.isRequired,
  unit:            PropTypes.string.isRequired,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTs(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// ── Main component ────────────────────────────────────────────────────────────
export function AllTeamsOverview({ teams, ecuList }) {
  // Sort teams by team_id so order is always stable regardless of how the
  // leaderboard API returns them (rank changes every 5s would otherwise reshuffle chips).
  const stableTeams = useMemo(
    () => [...teams].sort((a, b) => a.team_id - b.team_id),
    // We intentionally only re-sort when the SET of team IDs changes, not on every
    // rank update. We stringify sorted IDs as a stable key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify([...teams].map((t) => t.team_id).sort((a, b) => a - b))],
  );

  const teamColors = useMemo(() => {
    const map = {};
    stableTeams.forEach((t, i) => { map[t.team_id] = TEAM_COLORS[i % TEAM_COLORS.length]; });
    return map;
  }, [stableTeams]);

  const teamNames = useMemo(() => {
    const map = {};
    // Use live `teams` for names so renames propagate, but keys are stable.
    teams.forEach((t) => { map[t.team_id] = t.team_name; });
    return map;
  }, [teams]);

  const ecuByTeamId = useMemo(() => {
    const map = {};
    for (const ecu of ecuList) {
      if (ecu.team_id != null) map[ecu.team_id] = ecu;
    }
    return map;
  }, [ecuList]);

  const allTeamIds = useMemo(() => stableTeams.map((t) => t.team_id), [stableTeams]);
  const teamIdsKey = useMemo(
    () => JSON.stringify(allTeamIds),
    [allTeamIds],
  );

  // Filter / selection state.
  const [selectedTeamIds, setSelectedTeamIds] = useState(() => new Set(allTeamIds));
  const [activeTeamId, setActiveTeamId]       = useState(null);

  // Sync filter when team list changes (new event or new participants).
  const prevTeamIdsKeyRef = useRef(teamIdsKey);
  useEffect(() => {
    if (prevTeamIdsKeyRef.current !== teamIdsKey) {
      prevTeamIdsKeyRef.current = teamIdsKey;
      setSelectedTeamIds(new Set(allTeamIds));
      setActiveTeamId(null);
    }
  });

  // ── Live data: buffer frames in a ref, flush to state at 1 Hz ────────────
  // This prevents render storms when multiple teams are streaming concurrently.
  const [chartDataByTeam, setChartDataByTeam] = useState({});
  const pendingPointsRef    = useRef({});  // { teamId: point[] } accumulated since last flush
  const prevFrameTsRef      = useRef({});  // { teamId: lastFrameTimestamp }

  useEffect(() => {
    const wsMap = {};

    for (const teamId of allTeamIds) {
      const client = new WebSocketClient(
        `ws://localhost:8000/ws/team/${teamId}`,
        (frame) => {
          // Process on the WS message callback — no setState, no re-render.
          const prevTs = prevFrameTsRef.current[teamId] ?? null;
          if (prevTs === frame.timestamp) return; // deduplicate
          prevFrameTsRef.current[teamId] = frame.timestamp;
          const pts = expandSingleFrame(frame, prevTs);
          if (pts.length === 0) return;
          if (!pendingPointsRef.current[teamId]) pendingPointsRef.current[teamId] = [];
          pendingPointsRef.current[teamId].push(...pts);
        },
        null,
        null,
      );
      client.connect();
      wsMap[teamId] = client;
    }

    // Flush buffered points to state at most 4× per second.
    const flushInterval = setInterval(() => {
      const pending = pendingPointsRef.current;
      if (Object.keys(pending).length === 0) return;
      pendingPointsRef.current = {};
      setChartDataByTeam((prev) => {
        const next = { ...prev };
        for (const [idStr, newPts] of Object.entries(pending)) {
          const id = Number(idStr);
          const existing = prev[id] ?? [];
          next[id] = [...existing, ...newPts].slice(-200);
        }
        return next;
      });
    }, 250);

    return () => {
      clearInterval(flushInterval);
      for (const client of Object.values(wsMap)) client.close();
      pendingPointsRef.current = {};
      prevFrameTsRef.current   = {};
    };
  }, [teamIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Info for all selected teams ───────────────────────────────────────────
  // Map: teamId → { ecu, violations } | null (null = still loading)
  const [teamInfoMap, setTeamInfoMap] = useState({});

  useEffect(() => {
    // Load info for any selected team we don't have yet; drop teams no longer selected.
    setTeamInfoMap((prev) => {
      // Remove teams no longer selected.
      const pruned = {};
      for (const id of selectedTeamIds) {
        if (prev[id] !== undefined) pruned[id] = prev[id];
      }
      return pruned;
    });

    // Fetch missing teams.
    for (const teamId of selectedTeamIds) {
      setTeamInfoMap((prev) => {
        if (prev[teamId] !== undefined) return prev; // already have it
        // Start fetch; mark as loading with null.
        const ecu = ecuByTeamId[teamId];
        if (!ecu) {
          return { ...prev, [teamId]: { ecu: null, violations: [] } };
        }
        fetchViolations(ecu.id, 50)
          .then((violations) =>
            setTeamInfoMap((p) => ({ ...p, [teamId]: { ecu, violations } })),
          )
          .catch(() =>
            setTeamInfoMap((p) => ({ ...p, [teamId]: { ecu, violations: [] } })),
          );
        return { ...prev, [teamId]: null }; // null = loading
      });
    }
  }, [selectedTeamIds, ecuByTeamId]);

  // ── Chip interaction ──────────────────────────────────────────────────────
  function handleChipClick(teamId) {
    setActiveTeamId(teamId);
    setSelectedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  }

  const selectedIds = useMemo(() => [...selectedTeamIds], [selectedTeamIds]);

  // ── Merged chart data — one pass covers all 3 channels ───────────────────
  const liveMerged = useMemo(
    () => mergeAllForLiveChart(chartDataByTeam, selectedIds),
    [chartDataByTeam, selectedIds],
  );
  const voltageData = liveMerged.voltage;
  const currentData = liveMerged.current;
  const powerData   = liveMerged.power;


  if (teams.length === 0) return null;

  return (
    <div className="lb-overview-section">
      <div className="lb-overview-header">
        <div>
          <h2 className="lb-title">All Teams Overview</h2>
          <p className="lb-subtitle">Compare live telemetry across all teams</p>
        </div>
      </div>

      {/* Team filter chips */}
      <div className="overview-filter-row">
        <button
          className="overview-filter-preset"
          onClick={() => { setSelectedTeamIds(new Set(allTeamIds)); setActiveTeamId(null); }}
        >
          All
        </button>
        <button
          className="overview-filter-preset"
          onClick={() => { setSelectedTeamIds(new Set()); setActiveTeamId(null); }}
        >
          None
        </button>
        <div className="overview-chips">
          {stableTeams.map((t) => {
            const inChart = selectedTeamIds.has(t.team_id);
            const isActive = activeTeamId === t.team_id;
            return (
              <button
                key={t.team_id}
                className={`team-chip ${inChart ? "team-chip--selected" : ""} ${isActive ? "team-chip--active" : ""}`}
                style={{ "--chip-color": teamColors[t.team_id] }}
                onClick={() => handleChipClick(t.team_id)}
              >
                <span
                  className="team-chip-dot"
                  style={{ background: teamColors[t.team_id] }}
                />
                {t.team_name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Charts */}
      <div className="overview-charts">
        <div className="chart-section">
          <div className="chart-section-header"><h3>Voltage</h3></div>
          <MultiTeamChart
            mergedData={voltageData}
            selectedTeamIds={selectedIds}
            teamColors={teamColors}
            teamNames={teamNames}
            unit="V"
          />
        </div>
        <div className="chart-section">
          <div className="chart-section-header"><h3>Current</h3></div>
          <MultiTeamChart
            mergedData={currentData}
            selectedTeamIds={selectedIds}
            teamColors={teamColors}
            teamNames={teamNames}
            unit="A"
          />
        </div>
        <div className="chart-section">
          <div className="chart-section-header"><h3>Power</h3></div>
          <MultiTeamChart
            mergedData={powerData}
            selectedTeamIds={selectedIds}
            teamColors={teamColors}
            teamNames={teamNames}
            unit="W"
          />
        </div>
      </div>

      {/* Team info panels — one card per selected team, in stable order */}
      {selectedTeamIds.size > 0 && (
        <div className="overview-info-panels-row">
          {stableTeams
            .filter((t) => selectedTeamIds.has(t.team_id))
            .map((t) => {
              const info = teamInfoMap[t.team_id];
              const color = teamColors[t.team_id];
              return (
                <div
                  key={t.team_id}
                  className="overview-info-panel"
                  style={{ "--team-color": color }}
                >
                  <div className="overview-info-header">
                    <span className="overview-info-team-dot" style={{ background: color }} />
                    <h3 className="overview-info-team-name">{t.team_name}</h3>
                  </div>

                  {info === null || info === undefined ? (
                    <p className="overview-info-loading">Loading…</p>
                  ) : info.ecu == null ? (
                    <p className="overview-info-loading">No ECU assigned</p>
                  ) : (
                    <>
                      <div className="overview-info-cards">
                        {[
                          ["ECU ID",        info.ecu.id],
                          ["MAC Address",   info.ecu.mac_address ?? "—"],
                          ["Vehicle Class", info.ecu.vehicle_class ?? "—"],
                          ["Vehicle Type",  info.ecu.vehicle_type ?? "—"],
                          ["Team Number",   info.ecu.team_number ?? "—"],
                          ["Power Limit",
                            info.ecu.power_limit_watts != null
                              ? `${info.ecu.power_limit_watts} W`
                              : "—"],
                        ].map(([label, value]) => (
                          <div key={label} className="overview-info-card">
                            <span className="overview-info-label">{label}</span>
                            <span className={`overview-info-value${label === "MAC Address" ? " overview-info-mono" : ""}`}>
                              {value}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="overview-violations">
                        <h4 className="overview-violations-title">
                          Violations
                          {info.violations.length > 0 && (
                            <span className="overview-violations-count">
                              {info.violations.length}
                            </span>
                          )}
                        </h4>
                        {info.violations.length === 0 ? (
                          <p className="overview-info-loading">No violations recorded</p>
                        ) : (
                          <div className="overview-violations-list">
                            {info.violations.map((v, i) => (
                              <div key={i} className="overview-violation-row">
                                <span className="overview-violation-time">{fmtTs(v.started_at)}</span>
                                <span className="overview-violation-power">
                                  {v.peak_power_watts != null
                                    ? `${v.peak_power_watts.toFixed(1)} W`
                                    : "—"}
                                </span>
                                <span className={`lb-status ${v.status === "ended" ? "lb-status--scored" : "lb-status--pending"}`}>
                                  {v.status ?? "open"}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

AllTeamsOverview.propTypes = {
  teams:   PropTypes.arrayOf(
    PropTypes.shape({ team_id: PropTypes.number, team_name: PropTypes.string }),
  ).isRequired,
  ecuList: PropTypes.array.isRequired,
};
