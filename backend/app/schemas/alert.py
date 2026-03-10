# Pydantic schemas for alert request and response bodies.
#
# AlertResponse - returned to the frontend for each breach event:
#   id           - int, primary key
#   ecu_id       - int, which ECU triggered the alert
#   timestamp    - datetime, when the breach was detected
#   power_watts  - float, measured power at the time of breach 
#   limit_watts  - float, the configured limit that was exceeded
#   frame_id     - int, the energy frame that triggered this alert
#
# AlertListResponse - paginated wrapper returned by GET /alerts:
#   items  - list[AlertResponse]
#   total  - int
