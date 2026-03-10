// WebSocket client utility.
// Responsibilities:
//   - Creates a WebSocket connection to backend.
//   - Implements automatic reconnection with some sort of back off so the dashboard
//     recovers from brief network interruptions without user intervention.
//   - Parses incoming JSON messages and dispatches them to registered listener callbacks.
