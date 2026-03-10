# Pydantic schemas for energy frame request and response bodies.
#
# EnergyFrameCreate  - incoming payload from ESP32:
#                      ecu_serial (int), timestamp (datetime), avg_voltage (float),
#                      avg_current (float), energy (float)
# EnergyFrameResponse - outgoing response body sent to frontend using REST or WebSocket:
#                       adds id and ecu_id, mirrors EnergyFrameCreate fields
