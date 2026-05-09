import PropTypes from "prop-types";
import logo from "../assets/evolocity_logo.png";

const EVENT_LABELS = {
  drag_race: "Drag Race",
  gymkhana: "Gymkhana",
  endurance_efficiency: "Endurance & Efficiency",
};

export function Navbar({ connectedCount, totalCount, competition, onBack }) {
  const healthPct = totalCount > 0 ? Math.round((connectedCount / totalCount) * 100) : 100;

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
            {competition.events?.length > 0 && (
              <div className="navbar-event-badges">
                {competition.events.map((ev) => (
                  <span key={ev.id} className="navbar-event-badge">
                    {EVENT_LABELS[ev.event_type] ?? ev.event_type}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="navbar-center">
        <div className="nav-badge">
          <span className="nav-badge-dot active" />
          Local Network Active
        </div>
        <div className="nav-badge">
          <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
            <path d="M1 6c1.9-2.5 4.5-4 7-4s5.1 1.5 7 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M4 9c1.1-1.5 2.5-2.5 4-2.5S11 7.5 12 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="8" cy="12" r="1.5" fill="currentColor" />
          </svg>
          Gateway: 192.168.1.1
        </div>
        <div className="nav-badge">
          <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
            <path d="M3 8c0 1.5.8 2.8 2 3.5M13 8c0-2.76-2.24-5-5-5S3 5.24 3 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="8" cy="8" r="2" fill="currentColor" />
          </svg>
          System Health: {healthPct}%
        </div>
      </div>

      <div className="navbar-right">
        <button className="icon-btn" title="Settings">
          <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
            <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </nav>
  );
}

Navbar.propTypes = {
  connectedCount: PropTypes.number,
  totalCount: PropTypes.number,
  competition: PropTypes.object,
  onBack: PropTypes.func,
};

Navbar.defaultProps = {
  connectedCount: 0,
  totalCount: 0,
};
