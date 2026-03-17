from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import datetime
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)

# Not sure if this class is needed but would be good practise and would be good if there were multiple browsers connected
class ConnectionManager:
    """Manages active WebSocket connections grouped by named channel."""

    def __init__(self) -> None:
        self._channels: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, channel: str, websocket: WebSocket) -> None:
        """Accept and register a WebSocket on the given channel."""
        await websocket.accept()
        async with self._lock:
            self._channels[channel].add(websocket)
        logger.debug("WebSocket connected: channel=%s", channel)

    async def disconnect(self, channel: str, websocket: WebSocket) -> None:
        """Remove a WebSocket from the given channel."""
        async with self._lock:
            self._channels[channel].discard(websocket)
        logger.debug("WebSocket disconnected: channel=%s", channel)

    async def notify(self, channel: str, message: dict[str, Any]) -> None:
        """Send a JSON message to every subscriber on the given channel.

        Silently drops any connection that fails to send (e.g. already closed).
        """
        async with self._lock:
            sockets = set(self._channels.get(channel, set()))

        dead: list[WebSocket] = []
        for ws in sockets:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)

        if dead:
            async with self._lock:
                for ws in dead:
                    self._channels[channel].discard(ws)

    async def notify_alert(self, alert: Any) -> None:
        """Serialize an Alert ORM instance and push it to the global 'alerts' channel."""
        def _dt(value: datetime | None) -> str | None:
            return value.isoformat() if value is not None else None

        payload: dict[str, Any] = {
            "type": "alert",
            "id": alert.id,
            "ecu_id": alert.ecu_id,
            "timestamp": _dt(alert.timestamp),
            "power_watts": alert.power_watts,
            "limit_watts": alert.limit_watts,
            "frame_id": alert.frame_id,
        }
        await self.notify("alerts", payload)


# Module-level singleton shared by all routers.
manager = ConnectionManager()
