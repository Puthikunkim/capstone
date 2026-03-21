# Router: power limit breach alert endpoints.
#
# GET /alerts
#   Returns a paginated list of all breach alert events across all ECUs.
#   Could have query params to filter the list.
#
# GET /alerts/{id}
#   Returns the full detail of a single alert event by its id.

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.alert import AlertResponse
from app.services.storage import get_alert, get_alerts

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("/", response_model=list[AlertResponse])
def list_alerts(
    ecu_id: int | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    return get_alerts(db, ecu_id=ecu_id, start=start, end=end, limit=limit)


@router.get("/{alert_id}", response_model=AlertResponse)
def get_alert_by_id(alert_id: int, db: Session = Depends(get_db)):
    alert = get_alert(db, alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert
