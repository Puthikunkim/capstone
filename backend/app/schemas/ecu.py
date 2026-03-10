# Pydantic schemas for ECU related request and response bodies.
#
# ECUBase        - shared fields: serial_number, team_number, vehicle_class, vehicle_type,
#                  power_limit_watts
# ECUCreate      - used when an ESP32 first registers (inherits ECUBase)
# ECUUpdate      - used for configure requests, all fields optional
# ECUResponse    - returned to the frontend, adds id, last_seen, temperature, flash_usage,
#                  firmware_version, is_connected
