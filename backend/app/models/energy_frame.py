# SQLAlchemy ORM model for a single energy frame reading.
#   id          - auto incrementing primary key
#   ecu_id      - foreign key pointing to ecus.id
#   timestamp   - datetime, as reported by the ECU
#   avg_voltage - float, average voltage during this frame 
#   avg_current - float, average current during this frame 
#   energy      - float, energy recorded since the previous frame 