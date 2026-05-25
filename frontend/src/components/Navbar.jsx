import PropTypes from "prop-types";
import logo from "../assets/evolocity_logo.png";

const EVENT_LABELS = {
  drag_race: "Drag Race",
  gymkhana: "Gymkhana",
  endurance_efficiency: "Endurance & Efficiency",
};

export function Navbar({ connectedCount = 0, totalCount = 0, competition, selectedEvent, onBack, onTogglePanel, unreadCount, isDark, onToggleTheme }) {
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
        <button className="icon-btn" onClick={onToggleTheme} title={isDark ? "Switch to light mode" : "Switch to dark mode"}>
          {isDark ? (
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          )}
        </button>
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
  isDark: PropTypes.bool,
  onToggleTheme: PropTypes.func,
};

