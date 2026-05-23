import PropTypes from "prop-types";

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(seconds) {
  if (seconds == null) return "—";
  return seconds < 60
    ? `${seconds.toFixed(1)}s`
    : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(0)}s`;
}

export function NotificationPanel({ entries, onClose }) {
  return (
    <div className="notif-panel">
      <div className="notif-panel-header">
        <span className="notif-panel-title">Violation Log</span>
        <button className="notif-panel-close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="notif-panel-body">
        {entries.length === 0 ? (
          <div className="notif-panel-empty">No violations recorded this session</div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className={`notif-entry ${entry.isWarning ? "notif-entry--warning" : "notif-entry--violation"}`}>
              <div className="notif-entry-top">
                <span className="notif-entry-team">{entry.teamName}</span>
                <span className="notif-entry-time">{formatTime(entry.startTimestamp)}</span>
              </div>
              <div className="notif-entry-detail">
                <span>{entry.isWarning ? "Warning" : "Violation"}</span>
                <span>Duration: {formatDuration(entry.durationSeconds)}</span>
                <span>Penalty: {entry.penaltySeconds > 0 ? `${entry.penaltySeconds.toFixed(0)}s` : "none"}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

NotificationPanel.propTypes = {
  entries: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.number.isRequired,
      teamName: PropTypes.string.isRequired,
      startTimestamp: PropTypes.string,
      durationSeconds: PropTypes.number,
      penaltySeconds: PropTypes.number,
      isWarning: PropTypes.bool,
    })
  ).isRequired,
  onClose: PropTypes.func.isRequired,
};
