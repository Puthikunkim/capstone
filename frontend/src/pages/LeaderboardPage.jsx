import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { fetchEventLeaderboard } from "../api/http";

const EVENT_LABELS = {
  drag_race: "Drag Race",
  gymkhana: "Gymkhana",
  endurance_efficiency: "Endurance & Efficiency",
};

const STATUS_LABELS = {
  scored:  { text: "Scored",  cls: "lb-status--scored" },
  pending: { text: "Pending", cls: "lb-status--pending" },
  no_ecu:  { text: "No ECU",  cls: "lb-status--pending" },
};

function RankBadge({ rank }) {
  if (rank == null) return <span className="lb-rank lb-rank--none">—</span>;
  const cls = rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : "";
  return <span className={`lb-rank ${cls ? `lb-rank--${cls}` : ""}`}>{rank}</span>;
}
RankBadge.propTypes = { rank: PropTypes.number };

function fmtEnergy(wh) {
  if (wh == null) return "—";
  return wh < 1 ? `${(wh * 1000).toFixed(2)} mWh` : `${wh.toFixed(4)} Wh`;
}

function fmtPower(w) {
  if (w == null) return "—";
  return `${w.toFixed(1)} W`;
}

function fmtDuration(s) {
  if (s == null) return "—";
  return `${s.toFixed(1)} s`;
}

function fmtTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function LeaderboardPage({ eventId, eventType }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const intervalRef = useRef(null);

  const load = () => {
    fetchEventLeaderboard(eventId)
      .then((d) => {
        setData(d);
        setLastUpdated(new Date());
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    setData(null);
    load();
    intervalRef.current = setInterval(load, 5000);
    return () => clearInterval(intervalRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const scored  = data?.entries.filter((e) => e.status === "scored") ?? [];
  const pending = data?.entries.filter((e) => e.status !== "scored") ?? [];

  return (
    <div className="lb-page">
      <div className="lb-header">
        <div>
          <h2 className="lb-title">Efficiency Leaderboard</h2>
          <p className="lb-subtitle">
            {EVENT_LABELS[eventType] ?? eventType} · {data?.max_window_seconds ?? 30}s measurement window · lower energy = better
          </p>
        </div>
        <div className="lb-meta">
          {lastUpdated && (
            <span className="lb-updated">
              Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <span className="lb-refresh-dot" title="Auto-refreshes every 5s" />
        </div>
      </div>

      {loading && !data && (
        <div className="lb-empty">Loading leaderboard…</div>
      )}

      {error && (
        <div className="lb-empty lb-empty--error">{error}</div>
      )}

      {!loading && !error && data?.entries.length === 0 && (
        <div className="lb-empty">
          No participants yet. Set a start time and duration for each team via the dashboard to begin recording.
        </div>
      )}

      {scored.length > 0 && (
        <div className="lb-table-wrap">
          <table className="lb-table">
            <thead>
              <tr>
                <th className="lb-col-rank">Rank</th>
                <th className="lb-col-team">Team</th>
                <th className="lb-col-mac">ECU MAC</th>
                <th className="lb-col-num lb-col-energy">Energy (Wh)</th>
                <th className="lb-col-num">Avg Power</th>
                <th className="lb-col-num">Duration</th>
                <th className="lb-col-num">Last Reading</th>
              </tr>
            </thead>
            <tbody>
              {scored.map((entry) => (
                <tr key={entry.team_id} className={`lb-row lb-row--scored${entry.is_live ? " lb-row--live" : ""}`}>
                  <td><RankBadge rank={entry.rank} /></td>
                  <td>
                    <div className="lb-team-cell">
                      <span className="lb-team-name">{entry.team_name}</span>
                      {entry.is_live && <span className="lb-live-badge">LIVE</span>}
                    </div>
                  </td>
                  <td className="lb-mac">{entry.mac_address ?? "—"}</td>
                  <td className="lb-col-num lb-energy">{fmtEnergy(entry.energy_wh)}</td>
                  <td className="lb-col-num">{fmtPower(entry.avg_power_watts)}</td>
                  <td className="lb-col-num">{fmtDuration(entry.duration_seconds)}</td>
                  <td className="lb-col-num">{fmtTimestamp(entry.last_reading_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pending.length > 0 && (
        <div className="lb-pending-section">
          <div className="lb-pending-label">Awaiting data</div>
          <div className="lb-pending-list">
            {pending.map((entry) => {
              const s = STATUS_LABELS[entry.status] ?? { text: entry.status, cls: "" };
              return (
                <div key={entry.team_id} className="lb-pending-row">
                  <div className="lb-team-cell">
                    <span className="lb-team-name">{entry.team_name}</span>
                    {entry.is_live && <span className="lb-live-badge">LIVE</span>}
                  </div>
                  <span className={`lb-status ${s.cls}`}>{s.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

LeaderboardPage.propTypes = {
  eventId:   PropTypes.number.isRequired,
  eventType: PropTypes.string,
};
