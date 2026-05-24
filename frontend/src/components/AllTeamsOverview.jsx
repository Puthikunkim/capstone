import { useState, useEffect, useRef, useMemo, useCallback } from "react";
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
import { fetchEcuHistory, fetchViolations } from "../api/http";

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

function expandFrames(frames) {
  const points = [];
  for (let i = 0; i < frames.length; i++) {
    points.push(
      ...expandSingleFrame(frames[i], i > 0 ? frames[i - 1].timestamp : null),
    );
  }
  return points;
}

// Keys used in Recharts data objects. String keys avoid Recharts quirks with numeric dataKeys.
const teamKey = (teamId) => `t_${teamId}`;

// ── Merge per-team data into a single Recharts-compatible array ───────────────
// Live: index-aligned using each team's last maxPts points.
// Avoids server/browser clock-skew by never comparing server timestamps to Date.now().
function mergeForLiveChart(chartDataByTeam, selectedTeamIds, dataKey, maxPts = 100) {
  if (selectedTeamIds.length === 0) return [];

  // Slice each team to the last maxPts points and find the overall newest timestamp.
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
  if (maxLen === 0) return [];

  // End-align all teams: index 0 = oldest, index maxLen-1 = newest.
  const result = [];
  for (let i = 0; i < maxLen; i++) {
    const entry = {};
    let labelSet = false;
    for (const teamId of selectedTeamIds) {
      const pts = slices[teamId];
      const offset = pts.length - maxLen; // negative when shorter than maxLen
      const p = offset + i >= 0 ? pts[offset + i] : null;
      entry[teamKey(teamId)] = p ? p[dataKey] : null;
      if (!labelSet && p) {
        const diffMs = newestMs - new Date(p.timestamp).getTime();
        if (i === maxLen - 1) {
          entry.timeLabel = "Now";
        } else if (diffMs >= 60000) {
          entry.timeLabel = `-${Math.floor(diffMs / 60000)}m${Math.round((diffMs % 60000) / 1000)}s`;
        } else {
          entry.timeLabel = `-${Math.round(diffMs / 1000)}s`;
        }
        labelSet = true;
      }
    }
    if (!labelSet) entry.timeLabel = "";
    result.push(entry);
  }
  return result;
}

// History: 2s buckets spanning the full recorded range across all teams.
function mergeForHistoryChart(historyDataByTeam, selectedTeamIds, dataKey) {
  if (selectedTeamIds.length === 0) return [];
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const teamId of selectedTeamIds) {
    for (const p of (historyDataByTeam[teamId] ?? [])) {
      const t = new Date(p.timestamp).getTime();
      if (t < minMs) minMs = t;
      if (t > maxMs) maxMs = t;
    }
  }
  if (!isFinite(minMs)) return [];
  const bucketMs = 2000;
  const result = [];
  for (let t = minMs; t <= maxMs; t += bucketMs) {
    const label = new Date(t).toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const entry = { timeLabel: label, _ts: t };
    for (const teamId of selectedTeamIds) {
      const pts = historyDataByTeam[teamId] ?? [];
      let bestDiff = Infinity;
      let bestVal = null;
      for (const p of pts) {
        const diff = Math.abs(new Date(p.timestamp).getTime() - t);
        if (diff < bestDiff) { bestDiff = diff; bestVal = p[dataKey]; }
      }
      entry[teamKey(teamId)] = bestDiff <= bucketMs ? bestVal : null;
    }
    result.push(entry);
  }
  return result;
}

// ── Multi-team chart ──────────────────────────────────────────────────────────
const TOOLTIP_CONTENT_STYLE = {
  background: "#111827", border: "1px solid #1e2a3a",
  borderRadius: 8, fontSize: 12,
};

const PX_PER_POINT = 8;

function MultiTeamChart({ mergedData, selectedTeamIds, teamColors, teamNames, unit, onLoadMore, onScrollSync, registerScrollEl }) {
  const scrollRef        = useRef(null);
  const isAtEndRef       = useRef(true);
  const loadingMoreRef   = useRef(false);
  const prevLengthRef    = useRef(0);
  const prevFirstTsRef   = useRef(null);

  useEffect(() => {
    if (registerScrollEl && scrollRef.current) registerScrollEl(scrollRef.current);
  }, [registerScrollEl]);

  // When history data is prepended, shift scroll right to keep the viewed window stable.
  useEffect(() => {
    if (!onLoadMore) return;
    const el = scrollRef.current;
    if (!el || !mergedData.length) return;
    const firstTs = mergedData[0]?._ts ?? null;
    if (prevFirstTsRef.current !== null && firstTs !== prevFirstTsRef.current) {
      const added = mergedData.length - prevLengthRef.current;
      el.scrollLeft += added * PX_PER_POINT;
      loadingMoreRef.current = false;
    } else if (isAtEndRef.current) {
      el.scrollLeft = el.scrollWidth;
    }
    prevFirstTsRef.current = firstTs;
    prevLengthRef.current  = mergedData.length;
  }, [mergedData, onLoadMore]);

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

  const allVals = mergedData.flatMap((d) =>
    selectedTeamIds.map((id) => d[teamKey(id)]).filter((v) => v != null),
  );
  const min = allVals.length ? Math.min(...allVals) : 0;
  const max = allVals.length ? Math.max(...allVals) : 1;
  const pad = (max - min) * 0.2 || 1;
  const domain = [
    parseFloat((min - pad).toFixed(2)),
    parseFloat((max + pad).toFixed(2)),
  ];

  const lines = selectedTeamIds.map((teamId) => (
    <Line
      key={teamId}
      type="monotone"
      dataKey={teamKey(teamId)}
      stroke={teamColors[teamId]}
      dot={false}
      isAnimationActive={false}
      strokeWidth={1.5}
      connectNulls={false}
    />
  ));

  const axes = (
    <>
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
    </>
  );

  if (onLoadMore) {
    const totalWidth = Math.max(600, mergedData.length * PX_PER_POINT);
    const handleScroll = (e) => {
      const el = e.currentTarget;
      isAtEndRef.current = el.scrollLeft + el.clientWidth >= el.scrollWidth - 20;
      if (el.scrollLeft < 300 && !loadingMoreRef.current) {
        loadingMoreRef.current = true;
        onLoadMore();
      }
      onScrollSync?.(el.scrollLeft);
    };
    return (
      <div
        ref={scrollRef}
        className="history-chart-scroll"
        onScroll={handleScroll}
      >
        <div style={{ width: totalWidth, height: 220 }}>
          <LineChart
            width={totalWidth}
            height={220}
            data={mergedData}
            margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
          >
            {axes}
            {lines}
          </LineChart>
        </div>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={mergedData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        {axes}
        {lines}
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
export function AllTeamsOverview({ eventId, teams, ecuList }) {
  const teamColors = useMemo(() => {
    const map = {};
    teams.forEach((t, i) => { map[t.team_id] = TEAM_COLORS[i % TEAM_COLORS.length]; });
    return map;
  }, [teams]);

  const teamNames = useMemo(() => {
    const map = {};
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

  const allTeamIds = useMemo(() => teams.map((t) => t.team_id), [teams]);
  const teamIdsKey = useMemo(
    () => JSON.stringify([...allTeamIds].sort((a, b) => a - b)),
    [allTeamIds],
  );

  // Filter / selection state.
  const [selectedTeamIds, setSelectedTeamIds] = useState(() => new Set(allTeamIds));
  const [chartView, setChartView]             = useState("live");

  // Sync filter when team list changes (new event or new participants).
  const prevTeamIdsKeyRef = useRef(teamIdsKey);
  useEffect(() => {
    if (prevTeamIdsKeyRef.current !== teamIdsKey) {
      prevTeamIdsKeyRef.current = teamIdsKey;
      setSelectedTeamIds(new Set());
    }
  });

  // ── Live data: one WS per selected team, flush to state at 1 Hz ─────────
  const [chartDataByTeam, setChartDataByTeam] = useState({});
  const pendingPointsRef = useRef({});
  const prevFrameTsRef   = useRef({});
  const flushNowRef      = useRef(null);
  const wsMapRef         = useRef({});

  // Incrementally open/close connections as selection changes.
  useEffect(() => {
    // Close connections for teams no longer selected.
    for (const idStr of Object.keys(wsMapRef.current)) {
      const id = Number(idStr);
      if (!selectedTeamIds.has(id)) {
        wsMapRef.current[idStr].close();
        delete wsMapRef.current[idStr];
        delete pendingPointsRef.current[id];
        delete prevFrameTsRef.current[id];
      }
    }
    // Open connections for newly selected teams.
    for (const teamId of selectedTeamIds) {
      if (wsMapRef.current[teamId]) continue;
      const client = new WebSocketClient(
        `ws://localhost:8000/ws/team/${teamId}`,
        (frame) => {
          const prevTs = prevFrameTsRef.current[teamId] ?? null;
          if (prevTs === frame.timestamp) return;
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
      wsMapRef.current[teamId] = client;
    }
  }, [selectedTeamIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush interval runs independently — does not restart when selection changes.
  useEffect(() => {
    function flush() {
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
    }
    flushNowRef.current = flush;
    const interval = setInterval(flush, 100);
    return () => {
      clearInterval(interval);
      for (const client of Object.values(wsMapRef.current)) client.close();
      wsMapRef.current        = {};
      pendingPointsRef.current = {};
      prevFrameTsRef.current   = {};
    };
  }, []); // mount/unmount only

  // ── History data: fetch on demand per selected team, paginated ───────────
  const [historyDataByTeam, setHistoryDataByTeam] = useState({});
  const fetchedHistoryRef   = useRef(new Set());
  const historyHasMoreRef   = useRef({});
  const historyLoadingRef   = useRef({});
  const historyOldestTsRef  = useRef({});

  useEffect(() => {
    if (!eventId) return;
    for (const teamId of selectedTeamIds) {
      if (fetchedHistoryRef.current.has(teamId)) continue;
      fetchedHistoryRef.current.add(teamId);
      historyHasMoreRef.current[teamId] = true;
      const ecuId = ecuByTeamId[teamId]?.id;
      if (!ecuId) {
        setHistoryDataByTeam((prev) => ({ ...prev, [teamId]: [] }));
        historyHasMoreRef.current[teamId] = false;
        continue;
      }
      fetchEcuHistory(ecuId, { limit: 500, teamId })
        .then((frames) => {
          const sorted = [...frames].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          setHistoryDataByTeam((prev) => ({ ...prev, [teamId]: expandFrames(sorted) }));
          historyOldestTsRef.current[teamId] = sorted[0]?.timestamp ?? null;
          if (frames.length < 500) historyHasMoreRef.current[teamId] = false;
        })
        .catch(() => {
          setHistoryDataByTeam((prev) => ({ ...prev, [teamId]: [] }));
          historyHasMoreRef.current[teamId] = false;
        });
    }
  }, [selectedTeamIds, eventId, ecuByTeamId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shared scroll sync across all three history charts.
  const historyScrollElsRef = useRef([]);
  const registerHistoryScrollEl = useCallback((el) => {
    if (el && !historyScrollElsRef.current.includes(el)) {
      historyScrollElsRef.current.push(el);
    }
  }, []);
  const syncHistoryScroll = useCallback((scrollLeft) => {
    for (const el of historyScrollElsRef.current) {
      if (el.scrollLeft !== scrollLeft) el.scrollLeft = scrollLeft;
    }
  }, []);

  const loadMoreHistory = useCallback(() => {
    for (const teamId of selectedTeamIds) {
      if (!historyHasMoreRef.current[teamId]) continue;
      if (historyLoadingRef.current[teamId]) continue;
      const before = historyOldestTsRef.current[teamId];
      if (!before) continue;
      const ecuId = ecuByTeamId[teamId]?.id;
      if (!ecuId) continue;
      historyLoadingRef.current[teamId] = true;
      fetchEcuHistory(ecuId, { limit: 500, teamId, before })
        .then((frames) => {
          if (frames.length === 0) { historyHasMoreRef.current[teamId] = false; return; }
          const sorted = [...frames].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          setHistoryDataByTeam((prev) => ({
            ...prev,
            [teamId]: [...expandFrames(sorted), ...(prev[teamId] ?? [])],
          }));
          historyOldestTsRef.current[teamId] = sorted[0]?.timestamp ?? before;
          if (frames.length < 500) historyHasMoreRef.current[teamId] = false;
        })
        .catch(() => {})
        .finally(() => { historyLoadingRef.current[teamId] = false; });
    }
  }, [selectedTeamIds, ecuByTeamId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Info panels for all selected teams ───────────────────────────────────
  const [ecuInfoByTeamId, setEcuInfoByTeamId] = useState({});
  const fetchedTeamIds = useRef(new Set());

  useEffect(() => {
    for (const teamId of selectedTeamIds) {
      if (fetchedTeamIds.current.has(teamId)) continue;
      fetchedTeamIds.current.add(teamId);
      const ecu = ecuByTeamId[teamId];
      if (!ecu) {
        setEcuInfoByTeamId((p) => ({ ...p, [teamId]: { ecu: null, violations: [] } }));
      } else {
        fetchViolations(ecu.id, 50)
          .then((violations) => setEcuInfoByTeamId((p) => ({ ...p, [teamId]: { ecu, violations } })))
          .catch(() => setEcuInfoByTeamId((p) => ({ ...p, [teamId]: { ecu, violations: [] } })));
      }
    }
  }, [selectedTeamIds, ecuByTeamId]);

  // ── Chip interaction ──────────────────────────────────────────────────────
  function handleChipClick(teamId) {
    flushNowRef.current?.();
    setSelectedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  }

  const selectedIds = [...selectedTeamIds];

  // ── Merged chart data ─────────────────────────────────────────────────────
  const liveMergedVoltage = useMemo(
    () => mergeForLiveChart(chartDataByTeam, selectedIds, "voltage"),
    [chartDataByTeam, selectedTeamIds], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const liveMergedCurrent = useMemo(
    () => mergeForLiveChart(chartDataByTeam, selectedIds, "current"),
    [chartDataByTeam, selectedTeamIds], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const liveMergedPower = useMemo(
    () => mergeForLiveChart(chartDataByTeam, selectedIds, "power"),
    [chartDataByTeam, selectedTeamIds], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const histMergedVoltage = useMemo(
    () => mergeForHistoryChart(historyDataByTeam, selectedIds, "voltage"),
    [historyDataByTeam, selectedTeamIds], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const histMergedCurrent = useMemo(
    () => mergeForHistoryChart(historyDataByTeam, selectedIds, "current"),
    [historyDataByTeam, selectedTeamIds], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const histMergedPower = useMemo(
    () => mergeForHistoryChart(historyDataByTeam, selectedIds, "power"),
    [historyDataByTeam, selectedTeamIds], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const voltageData = chartView === "live" ? liveMergedVoltage : histMergedVoltage;
  const currentData = chartView === "live" ? liveMergedCurrent : histMergedCurrent;
  const powerData   = chartView === "live" ? liveMergedPower   : histMergedPower;

  if (teams.length === 0) return null;

  return (
    <div className="lb-overview-section">
      <div className="lb-overview-header">
        <div>
          <h2 className="lb-title">All Teams Overview</h2>
          <p className="lb-subtitle">Compare live and historical telemetry across all teams</p>
        </div>
        <div className="chart-view-toggle">
          <button
            className={`chart-view-btn ${chartView === "live" ? "active" : ""}`}
            onClick={() => setChartView("live")}
          >
            Live
          </button>
          <button
            className={`chart-view-btn ${chartView === "history" ? "active" : ""}`}
            onClick={() => setChartView("history")}
          >
            History
          </button>
        </div>
      </div>

      {/* Team filter chips */}
      <div className="overview-filter-row">
        <button
          className="overview-filter-preset"
          onClick={() => setSelectedTeamIds(new Set(allTeamIds))}
        >
          All
        </button>
        <button
          className="overview-filter-preset"
          onClick={() => setSelectedTeamIds(new Set())}
        >
          None
        </button>
        <div className="overview-chips">
          {teams.map((t) => {
            const inChart = selectedTeamIds.has(t.team_id);
            return (
              <button
                key={t.team_id}
                className={`team-chip ${inChart ? "team-chip--selected" : ""}`}
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
            onLoadMore={chartView === "history" ? loadMoreHistory : undefined}
            onScrollSync={chartView === "history" ? syncHistoryScroll : undefined}
            registerScrollEl={chartView === "history" ? registerHistoryScrollEl : undefined}
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
            onLoadMore={chartView === "history" ? loadMoreHistory : undefined}
            onScrollSync={chartView === "history" ? syncHistoryScroll : undefined}
            registerScrollEl={chartView === "history" ? registerHistoryScrollEl : undefined}
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
            onLoadMore={chartView === "history" ? loadMoreHistory : undefined}
            onScrollSync={chartView === "history" ? syncHistoryScroll : undefined}
            registerScrollEl={chartView === "history" ? registerHistoryScrollEl : undefined}
          />
        </div>
      </div>

      {/* Team info panels — one per selected team */}
      {selectedTeamIds.size > 0 && (
        <div className="overview-info-panels">
          {teams
            .filter((t) => selectedTeamIds.has(t.team_id))
            .map((t) => {
              const info = ecuInfoByTeamId[t.team_id];
              return (
                <div key={t.team_id} className="overview-info-panel">
                  <div className="overview-info-header">
                    <span
                      className="overview-info-team-dot"
                      style={{ background: teamColors[t.team_id] }}
                    />
                    <h3 className="overview-info-team-name">{t.team_name}</h3>
                  </div>

                  {info == null ? (
                    <p className="overview-info-loading">Loading…</p>
                  ) : info.ecu == null ? (
                    <p className="overview-info-loading">No ECU assigned to this team</p>
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
  eventId: PropTypes.number.isRequired,
  teams:   PropTypes.arrayOf(
    PropTypes.shape({ team_id: PropTypes.number, team_name: PropTypes.string }),
  ).isRequired,
  ecuList: PropTypes.array.isRequired,
};
