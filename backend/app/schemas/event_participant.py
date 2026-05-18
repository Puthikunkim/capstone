from __future__ import annotations

from datetime import datetime, timedelta

from pydantic import BaseModel, Field, computed_field


class EventParticipantCreate(BaseModel):
    team_id: int
    event_id: int
    start: datetime | None = None
    duration_seconds: float | None = Field(default=None, ge=0)


class EventParticipantUpdate(BaseModel):
    start: datetime | None = None
    duration_seconds: float | None = Field(default=None, ge=0)


class EventParticipantResponse(BaseModel):
    id: int
    team_id: int
    event_id: int
    start: datetime | None
    duration_seconds: float | None

    @computed_field
    @property
    def end(self) -> datetime | None:
        if self.start is None or self.duration_seconds is None:
            return None
        return self.start + timedelta(seconds=self.duration_seconds)

    model_config = {"from_attributes": True}
