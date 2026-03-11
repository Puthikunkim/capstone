# Storage service for database access layer.
#
# - save_frame: persist an energy frame to the energy frames table.
# - check_and_record_alert: called immediately after save_frame,
#                           computes instantaneous power from the frame,
#                           inserts an alert row if power limit is breached.
# - get_frames: time range query to grab list of energy frames
# - get_ecu: fetch one ECU row 
# - list_ecus: return all ECU rows
# - configure_ecu: apply ECU update fields
# - get_alerts: query alert table rows with optional filters
# - get_alert: fetch a single alert table row
