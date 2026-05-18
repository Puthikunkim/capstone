from __future__ import annotations

from datetime import datetime, timedelta

from pydantic import BaseModel, Field, computed_field


class EventParticipantCreate(BaseModel):
    team_id: int
    event_id: int
    start: datetime
    duration_seconds: float = Field(ge=0)


class EventParticipantUpdate(BaseModel):
    start: datetime | None = None
    duration_seconds: float | None = Field(default=None, ge=0)


class EventParticipantResponse(BaseModel):
    id: int
    team_id: int
    event_id: int
    start: datetime
    duration_seconds: float

    @computed_field
    @property
    def end(self) -> datetime:
        return self.start + timedelta(seconds=self.duration_seconds)

    model_config = {"from_attributes": True}
