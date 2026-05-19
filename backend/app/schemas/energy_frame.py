# Pydantic schemas for energy frame request and response bodies.
#
# EnergyFrameIngest  - incoming payload from ESP32 (raw ADC samples)
# EnergyFrameResponse - outgoing response body sent to frontend
from datetime import datetime

from pydantic import BaseModel


class EnergyFrameIngest(BaseModel):
    mac_address: str          # MAC address of the ESP32 that sent the frame
    timestamp: datetime       # ISO 8601 timestamp from ESP32
    voltage_samples: list[int]  # raw 12-bit ADC values (0-4095)
    current_samples: list[int]  # raw 12-bit ADC values (0-4095)


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
