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
import { fetchTeamFrames, fetchViolations } from "../api/http";

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

// Binary search: find index of the point in sortedPts whose _ts is nearest to targetMs.
function binarySearchNearest(sortedPts, targetMs) {
  let lo = 0, hi = sortedPts.length - 1;
  if (hi < 0) return null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedPts[mid]._ts < targetMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) {
    const before = sortedPts[lo - 1];
    const after  = sortedPts[lo];
    return (targetMs - before._ts) <= (after._ts - targetMs) ? before : after;
  }
  return sortedPts[lo];
}

// History: one pass for all 3 channels with pre-sort + binary search per bucket.
// O(teams × points × log) instead of O(buckets × teams × points).
function mergeAllForHistoryChart(historyDataByTeam, selectedTeamIds) {
  if (selectedTeamIds.length === 0) return { voltage: [], current: [], power: [] };

  // Pre-compute numeric timestamps once and sort each team's data.
  const sortedByTeam = {};
  let minMs = Infinity, maxMs = -Infinity;
  for (const teamId of selectedTeamIds) {
    const pts = (historyDataByTeam[teamId] ?? []).map((p) => ({
      ...p,
      _ts: new Date(p.timestamp).getTime(),
    })).sort((a, b) => a._ts - b._ts);
    sortedByTeam[teamId] = pts;
    if (pts.length > 0) {
      if (pts[0]._ts < minMs) minMs = pts[0]._ts;
      if (pts[pts.length - 1]._ts > maxMs) maxMs = pts[pts.length - 1]._ts;
    }
  }
  if (!Number.isFinite(minMs)) return { voltage: [], current: [], power: [] };

  const bucketMs = 2000;
  const voltage = [], current = [], power = [];
  for (let t = minMs; t <= maxMs; t += bucketMs) {
    const label = new Date(t).toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const vEntry = { timeLabel: label };
    const cEntry = { timeLabel: label };
    const pEntry = { timeLabel: label };
    for (const teamId of selectedTeamIds) {
      const key     = teamKey(teamId);
      const nearest = binarySearchNearest(sortedByTeam[teamId], t);
      if (nearest && Math.abs(nearest._ts - t) <= bucketMs) {
        vEntry[key] = nearest.voltage;
        cEntry[key] = nearest.current;
        pEntry[key] = nearest.power;
      } else {
        vEntry[key] = cEntry[key] = pEntry[key] = null;
      }
    }
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

const PX_PER_BUCKET = 8;
const MIN_CHART_WIDTH = 600;
const OVERSCAN = 150;

function MultiTeamChart({ mergedData, selectedTeamIds, teamColors, teamNames, unit, chartView, historyLoading, onLoadMore }) {
  const scrollRef          = useRef(null);
  const isAtEnd            = useRef(true);
  const rafRef             = useRef(null);
  const loadingMoreRef     = useRef(false);
  const prevDataLenRef     = useRef(0);
  const prevFirstLabelRef  = useRef(null);
  const [scrollLeft, setScrollLeft] = useState(0);

  useEffect(() => {
    if (chartView !== "history") return;
    const el = scrollRef.current;
    if (!el || !mergedData.length) return;

    const firstLabel = mergedData[0]?.timeLabel ?? null;
    if (prevFirstLabelRef.current && firstLabel !== prevFirstLabelRef.current) {
      // Data was prepended — shift right to keep the visible window stable.
      const added = mergedData.length - prevDataLenRef.current;
      el.scrollLeft += added * PX_PER_BUCKET;
      setScrollLeft(el.scrollLeft);
      loadingMoreRef.current = false;
    } else if (isAtEnd.current) {
      el.scrollLeft = el.scrollWidth;
      setScrollLeft(el.scrollLeft);
    }

    prevFirstLabelRef.current = firstLabel;
    prevDataLenRef.current    = mergedData.length;
  }, [mergedData, chartView]);

  useEffect(() => {
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    isAtEnd.current = el.scrollLeft + el.clientWidth >= el.scrollWidth - 20;

    if (el.scrollLeft < 300 && onLoadMore && !loadingMoreRef.current) {
      loadingMoreRef.current = true;
      onLoadMore();
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setScrollLeft(el.scrollLeft));
  };

  if (selectedTeamIds.length === 0) {
    return (
      <div className="chart-empty">
        <p>No teams selected</p>
        <span>Select at least one team above</span>
      </div>
    );
  }
  if (chartView === "history" && historyLoading) {
    return (
      <div className="chart-empty">
        <p>Loading history…</p>
        <span>Fetching recorded frames</span>
      </div>
    );
  }
  if (mergedData.length === 0) {
    return (
      <div className="chart-empty">
        {chartView === "history" ? (
          <>
            <p>No history available</p>
            <span>No recorded frames found for this event</span>
          </>
        ) : (
          <>
            <p>Waiting for data stream</p>
            <span>Start monitoring to see live data</span>
          </>
        )}
      </div>
    );
  }

  // Compute Y-axis domain from the full dataset so the axis stays stable while scrolling.
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
  const spread = Math.max(max - min, 1);
  const pad = spread * 0.3;
  const domain = [
    Number.parseFloat((min - pad).toFixed(2)),
    Number.parseFloat((max + pad).toFixed(2)),
  ];

  const sharedAxes = (
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
    </>
  );

  if (chartView === "history") {
    const totalWidth = Math.max(MIN_CHART_WIDTH, mergedData.length * PX_PER_BUCKET);
    const containerWidth = scrollRef.current?.clientWidth ?? 800;
    const visibleCount = Math.ceil(containerWidth / PX_PER_BUCKET);
    const startIdx = Math.max(0, Math.floor(scrollLeft / PX_PER_BUCKET) - OVERSCAN);
    const endIdx = Math.min(mergedData.length, startIdx + visibleCount + OVERSCAN * 2);
    const windowedData = mergedData.slice(startIdx, endIdx);
    const windowOffset = startIdx * PX_PER_BUCKET;
    const windowWidth = Math.max(MIN_CHART_WIDTH, windowedData.length * PX_PER_BUCKET);

    return (
      <div
        className="history-chart-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ position: "relative" }}
      >
        <div style={{ width: totalWidth, height: 220, position: "relative" }}>
          <div style={{ position: "absolute", left: windowOffset }}>
            <LineChart
              width={windowWidth}
              height={220}
              data={windowedData}
              margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
            >
              {sharedAxes}
            </LineChart>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={mergedData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        {sharedAxes}
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
  chartView:       PropTypes.string.isRequired,
  historyLoading:  PropTypes.bool.isRequired,
  onLoadMore:      PropTypes.func,
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
  const [chartView, setChartView]             = useState("live");

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

  // ── History data ──────────────────────────────────────────────────────────
  const [historyDataByTeam, setHistoryDataByTeam] = useState({});
  const [historyLoading, setHistoryLoading]     = useState(false);
  const historyHasMoreRef                        = useRef(true);
  const historyLoadingMoreRef                    = useRef(false);
  const historyOldestTsRef                       = useRef(null);

  // Track the oldest timestamp across all teams so loadMoreHistory knows where to paginate from.
  useEffect(() => {
    let oldest = null;
    for (const points of Object.values(historyDataByTeam)) {
      if (points.length > 0) {
        const ts = points[0].timestamp;
        if (oldest === null || ts < oldest) oldest = ts;
      }
    }
    historyOldestTsRef.current = oldest;
  }, [historyDataByTeam]);

  // Initial history load: last 500 frames per team in parallel.
  useEffect(() => {
    if (!eventId || teams.length === 0) return;
    setHistoryLoading(true);
    historyHasMoreRef.current    = true;
    historyLoadingMoreRef.current = false;
    const before = new Date().toISOString();
    Promise.all(
      teams.map((t) =>
        fetchTeamFrames(t.team_id, { eventId, before, limit: 500 })
          .then((frames) => ({ teamId: t.team_id, frames }))
          .catch(() => ({ teamId: t.team_id, frames: [] })),
      ),
    ).then((results) => {
      const map = {};
      for (const { teamId, frames } of results) {
        map[teamId] = expandFrames([...frames].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)));
      }
      if (results.every((r) => r.frames.length < 500)) historyHasMoreRef.current = false;
      setHistoryDataByTeam(map);
      setHistoryLoading(false);
    });
  }, [eventId, teamIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy-load older frames for all teams in parallel when the user scrolls left.
  const loadMoreHistory = useCallback(async () => {
    if (!historyHasMoreRef.current || historyLoadingMoreRef.current) return;
    const before = historyOldestTsRef.current;
    if (!before) return;
    historyLoadingMoreRef.current = true;
    const results = await Promise.all(
      teams.map((t) =>
        fetchTeamFrames(t.team_id, { eventId, before, limit: 500 })
          .then((frames) => ({ teamId: t.team_id, frames }))
          .catch(() => ({ teamId: t.team_id, frames: [] })),
      ),
    );
    const anyNew = results.some((r) => r.frames.length > 0);
    if (!anyNew || results.every((r) => r.frames.length < 500)) historyHasMoreRef.current = false;
    if (anyNew) {
      setHistoryDataByTeam((prev) => {
        const next = { ...prev };
        for (const { teamId, frames } of results) {
          const sorted = [...frames].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          next[teamId] = [...expandFrames(sorted), ...(prev[teamId] ?? [])];
        }
        return next;
      });
    }
    historyLoadingMoreRef.current = false;
  }, [eventId, teams]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [selectedTeamIds, ecuByTeamId]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const histMerged = useMemo(
    () => mergeAllForHistoryChart(historyDataByTeam, selectedIds),
    [historyDataByTeam, selectedIds],
  );

  const voltageData = chartView === "live" ? liveMerged.voltage : histMerged.voltage;
  const currentData = chartView === "live" ? liveMerged.current : histMerged.current;
  const powerData   = chartView === "live" ? liveMerged.power   : histMerged.power;

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
            chartView={chartView}
            historyLoading={historyLoading}
            onLoadMore={loadMoreHistory}
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
            chartView={chartView}
            historyLoading={historyLoading}
            onLoadMore={loadMoreHistory}
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
            chartView={chartView}
            historyLoading={historyLoading}
            onLoadMore={loadMoreHistory}
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
  eventId: PropTypes.number.isRequired,
  teams:   PropTypes.arrayOf(
    PropTypes.shape({ team_id: PropTypes.number, team_name: PropTypes.string }),
  ).isRequired,
  ecuList: PropTypes.array.isRequired,
};
