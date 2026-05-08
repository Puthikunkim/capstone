"""Shared frame ingestion logic used by both the serial reader and HTTP fallback."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.models.energy_frame import EnergyFrame
from app.schemas.energy_frame import EnergyFrameResponse
from app.services.broadcast import manager
from app.services.penalties import track_power_violation
from app.services.storage import check_and_record_alert, save_frame

logger = logging.getLogger(__name__)


async def persist_and_broadcast_frame(db: Session, processed: dict[str, Any]) -> tuple[EnergyFrame, bool]:
    frame, created = save_frame(db, processed)
    if not created:
        return frame, False

    violation_update = track_power_violation(db, frame, ecu=None)
    alert = None
    if violation_update.transition == "started":
        alert = check_and_record_alert(db, frame, ecu=None)

    if violation_update.event is not None and violation_update.transition in {"started", "ended"}:
        await manager.notify_violation_event(violation_update.event, violation_update.transition)

    channel = f"ecu_{frame.ecu_id}"
    subs = len(manager._channels.get(channel, set()))
    logger.info("Broadcasting to channel=%s  subscribers=%d", channel, subs)
    await manager.notify(
        channel,
        EnergyFrameResponse.model_validate(frame).model_dump(mode="json"),
    )

    if alert:
        await manager.notify_alert(alert)

    return frame, True
