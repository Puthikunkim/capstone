# Pydantic schemas for alert request and response bodies.
#
# AlertResponse - returned to the frontend for each breach event:
#   id           - int, primary key
#   ecu_id       - int, which ECU triggered the alert
#   timestamp    - datetime, when the breach was detected
#   power_watts  - float, measured power at the time of breach
#   limit_watts  - float, the configured limit that was exceeded
#   frame_id     - int, the energy frame that triggered this alert
from datetime import datetime

from pydantic import BaseModel


class AlertResponse(BaseModel):
    id: int
    ecu_id: int
    timestamp: datetime
    power_watts: float
    limit_watts: float
    frame_id: int

    model_config = {"from_attributes": True}
