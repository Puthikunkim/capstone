import { useState } from "react";
import PropTypes from "prop-types";

function ecuStatus(ecu) {
  if (ecu.is_connected) return "connected";
  if (ecu.last_seen) return "lost";
  return "disconnected";
}

function statusLabel(ecu) {
  const s = ecuStatus(ecu);
  if (s === "connected") return null;
  if (s === "lost") return "Connection Lost";
  return null;
}

function FlashIndicator({ flashUsage }) {
  if (flashUsage == null) return <span className="ecu-flash-value">--</span>;
  const kb = Math.round(flashUsage / 1024);
  return (
    <span className="ecu-flash-value">
      <svg viewBox="0 0 12 12" fill="none" width="10" height="10">
        <rect x="1" y="3" width="10" height="6" rx=".75" stroke="currentColor" strokeWidth="1.1" />
        <path d="M3.5 3V2.5M8.5 3V2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
      {kb} KB
    </span>
  );
}

FlashIndicator.propTypes = {
  flashUsage: PropTypes.number,
};

export function Sidebar({ ecuList, selectedEcuId, onEcuSelect }) {
  const [query, setQuery] = useState("");

  const filtered = ecuList.filter((ecu) => {
    const q = query.toLowerCase();
    const name = `team ${ecu.team_number}`.toLowerCase();
    const serial = String(ecu.serial_number ?? "");
    return name.includes(q) || serial.includes(q);
  });

  return (
    <aside className="sidebar">
      <div className="sidebar-search">
        <div className="search-input-wrap">
          <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Find ECU or Team..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="sidebar-section-label">Teams</div>

      <div className="sidebar-ecu-list">
        {ecuList.length === 0 && (
          <div className="sidebar-empty">No ECUs registered</div>
        )}
        {ecuList.length > 0 && filtered.length === 0 && (
          <div className="sidebar-empty">No results for &ldquo;{query}&rdquo;</div>
        )}
        {filtered.map((ecu) => {
          const status = ecuStatus(ecu);
          const isActive = selectedEcuId === ecu.id;
          const sublabel = statusLabel(ecu);

          return (
            <div
              key={ecu.id}
              className={`sidebar-ecu-item ${isActive ? "active" : ""} status-${status}`}
              onClick={() => onEcuSelect(ecu.id)}
            >
              <div className="ecu-item-main">
                <div className="ecu-item-info">
                  <span className="ecu-item-name">Team {ecu.team_number}</span>
                  <span className="ecu-item-class">{ecu.vehicle_class} Class</span>
                  {sublabel && (
                    <span className="ecu-item-sublabel">{sublabel}</span>
                  )}
                </div>
                <div className="ecu-item-right">
                  <div className={`ecu-dot ${status}`} />
                  <FlashIndicator flashUsage={ecu.flash_usage} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

Sidebar.propTypes = {
  ecuList: PropTypes.array.isRequired,
  selectedEcuId: PropTypes.number,
  onEcuSelect: PropTypes.func.isRequired,
};
