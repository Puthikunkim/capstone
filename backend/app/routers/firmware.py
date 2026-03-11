# Router: OTA firmware update endpoints.
#
# POST /ecu/{id}/firmware
#   - Accepts a firmware file.
#   - Stores the file temporarily on the server, then sends a firmware update
#     command to the target ESP32 using a dedicated WebSocket control channel. 
#   - The ESP32 fetches the file from a temporary endpoint and performs the OTA flash.
#   - Returns status code with a target job to poll for progress.
#
# GET /ecu/{id}/firmware/status
#   - Returns the current firmware update status for an ECU:
#   - status, progress (updated by the ESP32), and firmware version
#
# POST /ecu/{id}/firmware/status
#   Called by the ESP32 to report OTA progress back to the server during a flash.
#
# GET /ecu/{id}/firmware/download
#   Serves the firmware file to the ESP32 during an OTA update.
