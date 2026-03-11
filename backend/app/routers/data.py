# Router: POST /data
#   - Receives energy frame payloads posted by an ESP32.
#   - Validates the incoming payload.
#   - Persists the frame to db.
#   - Frames are stored by their ECU reported timestamp, not server receive time,
#     so that frames buffered on the ESP32 during a disconnection are stored in
#     correct chronological order when the ECU reconnects.
#   - Detect power limit breaches
#   - Push the new frame to WebSocket clients on that ECU's channel.
#   - Should handle at least 100 Hz per connected ESP32.
#   - Data must be stored and displayed at at least 10 Hz
#   - Greater than 100 Hz ADC sampling on the ESP32 is averaged before posting.
