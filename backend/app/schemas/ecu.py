# Pydantic schemas for ECU related request and response bodies.
#
# - ECUBase: shared fields for other ECU classes
# - ECUCreate: used when an ESP32 first registers (inherits ECUBase)
# - ECUUpdate: used for configure requests
# - ECUResponse: returned to the frontend
