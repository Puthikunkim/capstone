# Pydantic schemas for ECU related request and response bodies.
#
# - ECUBase: shared fields sent by the ESP32
# - ECUCreate: used when an ESP32 first registers (inherits ECUBase)
# - ECUConfigure: used for configure requests (all fields optional)
# - ECUResponse: returned to the frontend
from datetime import datetime

from pydantic import BaseModel

from app.models.ecu import VehicleClass, VehicleType


class ECUBase(BaseModel):
    serial_number: int
    team_number: int
    vehicle_class: VehicleClass
    vehicle_type: VehicleType
    power_limit_watts: float
    firmware_version: str | None


class ECUCreate(ECUBase):
    pass


class ECUConfigure(BaseModel):
    team_number: int | None = None
    vehicle_class: VehicleClass | None = None
    vehicle_type: VehicleType | None = None
    power_limit_watts: float | None = None
    firmware_version: str | None = None


class ECUResponse(ECUBase):
    id: int
    team_id: int | None
    last_seen: datetime | None
    temperature: float | None
    flash_usage: int | None
    is_connected: bool

    model_config = {"from_attributes": True}
