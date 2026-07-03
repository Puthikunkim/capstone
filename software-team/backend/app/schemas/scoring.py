from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel

from app.models.ecu import VehicleClass, VehicleType


class ScoringMetric(str, Enum):
    ENERGY_WH = "energy_wh"
    AVG_POWER_WATTS = "avg_power_watts"
    ELAPSED_SECONDS = "elapsed_seconds"


class ScoringEnergySource(str, Enum):
    TRANSMITTED = "transmitted"
    INTEGRATED_POWER = "integrated_power"


class ScoringStatus(str, Enum):
    SCORED = "scored"
    DNF = "dnf"


class ScoringEntryResponse(BaseModel):
    rank: int | None
    ecu_id: int
    mac_address: str | None
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
    energy_source: ScoringEnergySource
    brackets: list[ScoringBracketResponse]


class LeaderboardStatus(str, Enum):
    SCORED = "scored"    # has frames, energy calculated
    PENDING = "pending"  # has ECU but no frames yet
    NO_ECU = "no_ecu"    # no ECU assigned — excluded from display


class LeaderboardEntry(BaseModel):
    rank: int | None
    team_id: int
    team_name: str
    ecu_id: int | None
    mac_address: str | None
    energy_wh: float | None
    avg_power_watts: float | None
    duration_seconds: float | None
    frame_count: int
    status: LeaderboardStatus
    is_live: bool
    last_reading_at: datetime | None


class EventLeaderboardResponse(BaseModel):
    event_id: int
    max_window_seconds: int
    entries: list[LeaderboardEntry]
