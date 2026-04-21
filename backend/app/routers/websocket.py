from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.broadcast import manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/alerts")
async def ws_alerts(websocket: WebSocket) -> None:
    """Subscribe to power-limit breach alert notifications.

    The server pushes a JSON object whenever a new alert is recorded.
    Clients should not send anything; the connection is receive-only.
    """
    channel = "alerts"
    await manager.connect(channel, websocket)
    try:
        while True:
            # Block here to keep the connection alive.
            # Any message from the client is discarded.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(channel, websocket)


@router.websocket("/ws/violations")
async def ws_violations(websocket: WebSocket) -> None:
    """Subscribe to power violation lifecycle notifications.

    The server pushes a JSON object when a violation event starts or ends.
    Clients should not send anything; the connection is receive-only.
    """
    channel = "violations"
    await manager.connect(channel, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(channel, websocket)


@router.websocket("/ws/{ecu_id}")
async def ws_ecu_frames(websocket: WebSocket, ecu_id: int) -> None:
    """Subscribe to live energy frame updates for a specific ECU.

    The server pushes a JSON object for every new frame recorded for this ECU.
    Clients should not send anything; the connection is receive-only.
    """
    channel = f"ecu_{ecu_id}"
    await manager.connect(channel, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(channel, websocket)
