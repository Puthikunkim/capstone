from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.power_violation_event import PowerViolationEventResponse
from app.services.penalties import get_violation_event, get_violation_events

router = APIRouter(prefix="/violations", tags=["violations"])


@router.get("/", response_model=list[PowerViolationEventResponse])
def list_power_violations(
	ecu_id: int | None = None,
	start: datetime | None = None,
	end: datetime | None = None,
	open_only: bool = False,
	limit: int = 100,
	db: Session = Depends(get_db),
):
	return get_violation_events(
		db,
		ecu_id=ecu_id,
		start=start,
		end=end,
		open_only=open_only,
		limit=limit,
	)


@router.get("/{event_id}", response_model=PowerViolationEventResponse)
def get_power_violation(event_id: int, db: Session = Depends(get_db)):
	event = get_violation_event(db, event_id)
	if event is None:
		raise HTTPException(status_code=404, detail="Violation event not found")
	return event
