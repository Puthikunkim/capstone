// FirmwareUpdate page for OTA firmware update interface.
// Responsibilities:
//   - Lists all registered ECUs with their current firmware version.
//   - Provides a file input to select a file.
//   - On submit, uploads the file to the backend using POST request.
//   - Displays a live progress bar for the OTA flash process by polling.
//   - Shows a clear success/failure message when the update completes.
