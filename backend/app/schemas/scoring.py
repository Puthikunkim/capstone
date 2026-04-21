from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel

from app.models.ecu import VehicleClass, VehicleType


class ScoringMetric(str, Enum):
    ENERGY_WH = "energy_wh"
    AVG_POWER_WATTS = "avg_power_watts"
    ELAPSED_SECONDS = "elapsed_seconds"


class ScoringStatus(str, Enum):
    SCORED = "scored"
    DNF = "dnf"


class ScoringEntryResponse(BaseModel):
    rank: int | None
    ecu_id: int
    serial_number: int
    team_number: int
    status: ScoringStatus
    score: float
    metric_value: float | None
    total_energy_wh: float | None
    avg_power_watts: float | None
    elapsed_seconds: float | None
    frame_count: int


class ScoringBracketResponse(BaseModel):
    vehicle_class: VehicleClass
    vehicle_type: VehicleType
    entries: list[ScoringEntryResponse]


class ScoringEventResponse(BaseModel):
    event_id: str
    start: datetime
    end: datetime
    metric: ScoringMetric
    brackets: list[ScoringBracketResponse]
