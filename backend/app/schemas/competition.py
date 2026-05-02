from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.models.competition import CompetitionEventType


class CompetitionBase(BaseModel):
    name: str = Field(min_length=1, max_length=128)

    @field_validator("name")
    @classmethod
    def _normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Competition name must not be blank")
        return normalized


class CompetitionCreate(CompetitionBase):
    event_types: list[CompetitionEventType] = list(CompetitionEventType)


class CompetitionEventResponse(BaseModel):
    id: int
    event_type: CompetitionEventType

    model_config = {"from_attributes": True}


class CompetitionResponse(CompetitionBase):
    id: int

    model_config = {"from_attributes": True}


class CompetitionDetailResponse(CompetitionResponse):
    events: list[CompetitionEventResponse] = Field(default_factory=list)
