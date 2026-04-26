# Pydantic schemas for energy frame request and response bodies.
#
# EnergyFrameIngest  - incoming payload from ESP32 (raw ADC samples)
# EnergyFrameResponse - outgoing response body sent to frontend
from datetime import datetime

from pydantic import BaseModel


class EnergyFrameIngest(BaseModel):
    ecu_serial: int           # identifies which ECU sent the frame
    timestamp: datetime       # ISO 8601 timestamp from ESP32
    voltage_samples: list[int]  # raw 12-bit ADC values (0-4095)
    current_samples: list[int]  # raw 12-bit ADC values (0-4095)


class EnergyFrameResponse(BaseModel):
    id: int
    ecu_id: int
    timestamp: datetime
    avg_voltage: float
    avg_current: float
    power_watts: float
    energy: float              

    model_config = {"from_attributes": True}


class EnergyFrameBatchIngest(BaseModel):
    frames: list[EnergyFrameIngest]


class EnergyFrameBatchResponse(BaseModel):
    received: int
    inserted: int
    duplicates: int
    frames: list[EnergyFrameResponse]
