import PropTypes from "prop-types";
import logo from "../assets/evolocity_logo.png";

const EVENT_LABELS = {
  drag_race: "Drag Race",
  gymkhana: "Gymkhana",
  endurance_efficiency: "Endurance & Efficiency",
};

export function Navbar({ connectedCount, totalCount, competition, selectedEvent, onBack, onTogglePanel, unreadCount }) {
  const healthPct = totalCount > 0 ? Math.round((connectedCount / totalCount) * 100) : 100;
  const badgeEvents = selectedEvent ? [selectedEvent] : (competition?.events ?? []);

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        {onBack && (
          <button className="navbar-back-btn" onClick={onBack} title="Back to Competitions">
            <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <img src={logo} alt="EVolocity" className="navbar-logo-img" />
        {competition && (
          <>
            <span className="navbar-competition-name">{competition.name}</span>
            {badgeEvents.length > 0 && (
              <div className="navbar-event-badges">
                {badgeEvents.map((ev) => (
                  <span key={ev.id} className="navbar-event-badge">
                    {EVENT_LABELS[ev.event_type] ?? ev.event_type}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="navbar-center"/>
   
      <div className="navbar-right">
        {onTogglePanel && (
          <button className="icon-btn notif-bell-btn" onClick={onTogglePanel} title="Violation log">
            <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
              <path d="M10 2a6 6 0 00-6 6v2.586l-.707.707A1 1 0 004 13h12a1 1 0 00.707-1.707L16 10.586V8a6 6 0 00-6-6zm0 16a2 2 0 002-2H8a2 2 0 002 2z" />
            </svg>
            {unreadCount > 0 && (
              <span className="notif-bell-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
            )}
          </button>
        )}
     
      </div>
    </nav>
  );
}

Navbar.propTypes = {
  connectedCount: PropTypes.number,
  totalCount: PropTypes.number,
  competition: PropTypes.object,
  selectedEvent: PropTypes.object,
  onBack: PropTypes.func,
  onTogglePanel: PropTypes.func,
  unreadCount: PropTypes.number,
};

Navbar.defaultProps = {
  connectedCount: 0,
  totalCount: 0,
};
