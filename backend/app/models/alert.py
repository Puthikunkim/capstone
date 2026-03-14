# SQLAlchemy ORM model for a power limit breach alert event.
#   id          - auto incrementing primary key
#   ecu_id      - foreign key pointing to ecus.id
#   timestamp   - datetime, when the breach was detected
#   power_watts - float, instantaneous power at the time of the breach
#                 from the target energy frame
#   limit_watts - float, the configured power limit for this ECU at the
#                 time of the breach
#   frame_id    - foreign key pointing to energy_frames.id, the frame
#                 that triggered the alert
