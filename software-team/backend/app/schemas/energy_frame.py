# Pydantic schemas for energy frame request and response bodies.
#
# EnergyFrameIngest  - incoming payload from ESP32 (already converted by ESP)
# EnergyFrameResponse - outgoing response body sent to frontend
from datetime import datetime

from pydantic import BaseModel


class EnergyFrameIngest(BaseModel):
    mac_address: str          # MAC address of the ESP32 that sent the frame
    timestamp: datetime       # ISO 8601 timestamp from ESP32
    voltage_samples: list[float]  # already-converted voltage values from ESP32
    current_samples: list[float]  # already-converted current values from ESP32


class EnergyFrameResponse(BaseModel):
    id: int
    ecu_id: int
    timestamp: datetime
    voltage_samples: list[float] | None = None
    current_samples: list[float] | None = None
    power_samples: list[float] | None = None
    energy: float

    model_config = {"from_attributes": True}


class EnergyFrameBatchIngest(BaseModel):
    frames: list[EnergyFrameIngest]


class EnergyFrameBatchResponse(BaseModel):
    received: int
    inserted: int
    duplicates: int
    frames: list[EnergyFrameResponse]
