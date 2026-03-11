# Router: WebSocket endpoint /ws/{ecu_id}
# - Accepts WebSocket requests from the frontend.
# - Registers the connection with a connection manager
# - Keeps the connection alive, forwarding every new energy frame for the
#   requested ecu as a JSON message.
# - Handles client disconnection requests
