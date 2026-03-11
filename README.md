[![Review Assignment Due Date](https://classroom.github.com/assets/deadline-readme-button-22041afd0340ce965d47ae6ef1cefeee28c7c493a6346c4f15d667ab976d596c.svg)](https://classroom.github.com/a/IjV0HRak)

# EVolocity ECU Dashboard - Software Component

Browser based real time dashboard for the EVolocity Control Unit (ECU) wireless data system.  
The system wirelessly collects energy data from ESP32 based ECUs mounted on EVolocity vehicles and displays it live in a browser.

---

## Project Overview

Each EVolocity vehicle carries an ECU that records voltage, current, and energy data during racing. This software system:

- Receives energy frames posted over HTTPS from one or more ESP32 boards.
- Stores all readings to a local SQLite database by the ECU reported timestamp so out of order data flushed after a reconnection is stored correctly.
- Pushes new readings to connected browser in real time using a WebSocket.
- Provides a browser based dashboard where users can:
  - View all registered ECUs with live **connected / disconnected** status.
  - Select any ECU to view its real time and historical voltage, current, and energy data.
  - Receive instant **power limit breach notifications** when an ECU exceeds its configured watt limit.
  - **Configure ECU settings:** team number, vehicle class, vehicle type, and per ECU power limit.
  - **Perform OTA firmware updates** on any ECU wirelessly, with live progress tracking.
- Runs entirely on a **local Windows laptop** with no internet connection or cloud services.

**Milestone 1 requirements:**

- [ ] ESP32 ADC reads voltage at ≥ 100 Hz and POSTs to the server via HTTPS.
- [ ] Server receives and stores readings, broadcasts to frontend using a WebSocket.
- [ ] Frontend graphs data in real time at ≥ 10 Hz.
- [ ] Software connects to two ESP32 boards simultaneously, user can display data from either (one at a time).

---

## Tech Stack

| Layer              | Technology                 |
| ------------------ | -------------------------- |
| Backend server     | **Python + FastAPI**       |
| Data persistence   | **SQLite + SQLAlchemy**    |
| Data validation    | **Pydantic**               |
| Frontend framework | **React**                  |
| Charting           | **Recharts**               |
| Communication      | **HTTPS POST + WebSocket** |

> **Note on SQLite scalability:** SQLite is used in the prototype for simplicity. If the system needs to be extended, migrate to PostgreSQL.

---

## Communication Flow

```
┌─────────────────────────┐        HTTPS POST /data         ┌────────────────────────────────┐
│  ESP32 (ECU board #1)   │ ──────────────────────────────► │                                │
└─────────────────────────┘       ≥ 100 Hz, JSON payload    │   FastAPI Backend (Python)     │
                                                            │                                │
┌─────────────────────────┐        HTTPS POST /data         │  • Validates payload (Pydantic)│
│  ESP32 (ECU board #2)   │ ──────────────────────────────► │  • Persists to SQLite          │
└─────────────────────────┘                                 │  • Broadcasts to client        │
                                                            │                                │
                                                            └──────────┬─────────────────────┘
                                                                        │
                                                           WebSocket /ws/{ecu_id}
                                                           live JSON frames, ≥ 10 Hz
                                                                        │
                                                                        ▼
                                                          ┌─────────────────────────┐
                                                          │  React Frontend         │
                                                          │  • ECU selector         │
                                                          │  • Live Recharts graph  │
                                                          │  • Status panel         │
                                                          │  • Data table           │
                                                          └─────────────────────────┘
```

**Request/Response shapes idea:**

ESP32 POST body:

```json
{
  "ecu_serial": 12345,
  "timestamp": "2026-03-10T09:00:00.000Z",
  "avg_voltage": 48.2,
  "avg_current": 12.5,
  "energy": 0.603
}
```

WebSocket message pushed to browser:

```json
{
  "id": 1001,
  "ecu_id": 3,
  "timestamp": "2026-03-10T09:00:00.000Z",
  "avg_voltage": 48.2,
  "avg_current": 12.5,
  "energy": 0.603
}
```

---

## Project Structure

```
capstone-project-software-team-6/
├── README.md
├── SBOM.md
│
├── backend/                         Python + FastAPI server
│   ├── main.py                      App entry point, mounts all routers, configures CORS, starts uvicorn
│   ├── requirements.txt             Python package dependencies
│   ├── .env.example                 Environment variable template
│   └── app/
│       ├── config.py                Centralised settings object (reads from .env)
│       ├── database.py              SQLAlchemy engine, Base, and get_db() session dependency
│       ├── models/
│       │   ├── ecu.py               ORM model for ECU rows
│       │   ├── energy_frame.py      ORM model for energy frame rows
│       │   └── alert.py             ORM model for power limit breach event rows
│       ├── routers/
│       │   ├── data.py              Route to ingest frames and triggers breach detection and broadcast
│       │   ├── ecu.py               Route to query ECUs
│       │   ├── websocket.py         WebSocket to live stream to browser
│       │   ├── alerts.py            Route to query power limit breach
│       │   └── firmware.py          Route for OTA firmware update
│       ├── schemas/
│       │   ├── ecu.py               Pydantic shapes for ECU
│       │   ├── energy_frame.py      Pydantic shapes for energy frames
│       │   └── alert.py             Pydantic shapes for alert events
│       └── services/
│           ├── broadcast.py         Connection manager for WebSockets
│           └── storage.py           DB access
│   └── tests/
│       ├── test_data.py             Unit tests for /data endpoint
│       ├── test_ecu.py              Unit tests for ECU management endpoints
│       ├── test_alerts.py           Unit tests for breach detection and alert endpoints
│       └── test_firmware.py         Unit tests for OTA firmware update endpoints
│
└── frontend/                        React browser app
    ├── index.html
    ├── package.json                 JS dependencies and npm scripts
    ├── vite.config.js               Vite config
    ├── .env.example                 Frontend env variable template
    └── src/
        ├── main.jsx                 React DOM render root, mounts <App /> into root
        ├── App.jsx                  Root component
        ├── api/
        │   ├── http.js              Fetch wrapper for HTTP REST calls
        │   └── websocket.js         WebSocket client connection management
        ├── components/
        │   ├── EnergyChart.jsx      Live Recharts line chart
        │   ├── ECUList.jsx          Display ECU connection states
        │   ├── ECUSelector.jsx      Dropdown to switch the active ECU
        │   ├── ECUStatusPanel.jsx   Panel for ECU status
        │   ├── ConnectionStatus.jsx Badge: Display WebSocket state
        │   ├── NotificationPanel.jsx Notifications for power limit breach alerts
        │   └── DataTable.jsx        Scrollable table of recent frames
        ├── hooks/
        │   ├── useWebSocket.js      Hook for WebSocket lifecycle
        │   └── useECUData.js        Hook for REST fetch
        └── pages/
            ├── Dashboard.jsx        Main page
            ├── Settings.jsx         Change ECU settings
            └── FirmwareUpdate.jsx   OTA firmware upload with live progress tracking
```

---

## GitHub Workflow

### Rules

- **Never push directly to `main`.** All changes must arrive using a reviewed and approved pull request.
- **Branch from `main`** every time you start a new feature or bug fix.
- **Branch naming:** use descriptive, lowercase, hyphen-separated names that indicate the work being done, e.g.:
  - `feature/websocket-broadcast`
- **Commit and push frequently** while working. Do not wait until a feature is complete before pushing.
- **Pull from `main` often** to keep your branch up to date and minimise merge conflicts.

### Pull Request Process

1. Push your branch and open a pull request on GitHub.
2. Give the PR a short, descriptive title summarising the change
3. Use the PR body to explain _what_ changed and _why_ (link to any relevant issue or task).
4. Request a review from at least one other team member.
5. The reviewer leaves comments on specific lines or the overall PR. Address all comments with new commits.
6. Once the reviewer approves, merge the PR using the "Squash and merge" or "Merge commit" strategy (strategy we need to agree on).
7. Delete the branch after merging to keep the repository tidy.

### Commit Message Convention

Use the conventional commits format for consistency:

```
<type>: <short summary>

type = feat | fix | test | chore | docs | refactor
```

Examples:

- `feat: add POST /data endpoint`
- `fix: handle WebSocket disconnect without crashing`
