from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.models.ecu import VehicleClass, VehicleType


class TeamBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    vehicle_class: VehicleClass
    vehicle_type: VehicleType

    @field_validator("name")
    @classmethod
    def _normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Team name must not be blank")
        return normalized


class TeamCreate(TeamBase):
    competition_id: int | None = None


class TeamResponse(TeamBase):
    id: int
    competition_id: int | None = None

    model_config = {"from_attributes": True}


class TeamDetailResponse(TeamResponse):
    assigned_ecu_ids: list[int] = Field(default_factory=list)
