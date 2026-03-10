# SQLAlchemy ORM model for an ECU (EVolocity Control Unit) device.
#   id                - auto incrementing primary key
#   serial_number     - int, unique identifier flashed onto the ECU
#   team_number       - int, assigned team number
#   vehicle_class     - enum: "Standard" or "Open" 
#   vehicle_type      - enum: "bike" or "kart"
#   power_limit_watts - float, configurable power limit in watts                       
#   last_seen         - datetime, updated every time the ECU posts data
#   temperature       - float, most recent internal temperature reading 
#   flash_usage       - int, flash memory usage
#   firmware_version  - string, version string reported by the ECU on each data post
#
# Derived (not a column - is computed):
#   is_connected      - bool: True if last_seen is within 10 seconds
