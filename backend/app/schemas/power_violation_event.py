from datetime import datetime

from pydantic import BaseModel


class PowerViolationEventResponse(BaseModel):
	id: int
	ecu_id: int
	start_timestamp: datetime
	last_over_timestamp: datetime
	end_timestamp: datetime | None
	duration_seconds: float
	penalty_seconds: float
	limit_watts: float
	peak_power_watts: float
	frame_count: int
	is_warning: bool

	model_config = {"from_attributes": True}
