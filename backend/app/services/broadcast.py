# Connection manager for managing active WebSocket connections.
#
# Responsibilities:
#   - connect: register a new WebSocket subscriber for a channel.
#   - disconnect: remove a subscriber when the client disconnects.
#   - notify: broadcast a message to all subscribers of the given channel
#   - notify_alert: wrapper to serialise an alert and notifies the
#                   alerts channel so all connected browsers receive the breach
#                   notification.
