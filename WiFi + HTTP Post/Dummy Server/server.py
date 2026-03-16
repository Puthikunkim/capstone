from fastapi import FastAPI, Request, HTTPException
from datetime import datetime, timezone, timedelta
import uvicorn
import json

app = FastAPI()

ecu_anchors: dict = {}


def get_anchor(ecu_serial_number: int) -> dict:
    if ecu_serial_number not in ecu_anchors:
        print(f"[ECU {ecu_serial_number}] /connect not received yet")
        raise HTTPException(status_code=400, detail=f"ECU {ecu_serial_number} has not connected yet")
    return ecu_anchors[ecu_serial_number]

def time_since_boot_to_wall(anchor: dict, time_since_boot: int) -> datetime:
    offset_us = time_since_boot - anchor["time_since_boot_anchor"]
    return anchor["wall_anchor"] + timedelta(microseconds=offset_us)

@app.post("/connect")
async def connect(request: Request):
    raw = await request.body()
    print(f"Raw connect body: {raw}")
    try:
        body = json.loads(raw)
    except Exception as e:
        print(f"JSON parse error: {e}")
        raise HTTPException(status_code=400, detail=f"Bad JSON: {e}")
    
    ecu_serial_number = body.get("ecu_serial_number")
    time_since_boot   = body.get("time_since_boot")
    if ecu_serial_number is None or time_since_boot is None:
        print(f"Missing fields, got: {body}")
        raise HTTPException(status_code=400, detail=f"Missing fields — got: {body}")
    
    wall_now = datetime.now(timezone.utc)
    ecu_anchors[ecu_serial_number] = {
        "wall_anchor":            wall_now,
        "time_since_boot_anchor": time_since_boot,
    }
    print(f"[ECU {ecu_serial_number}] wall={wall_now.isoformat()} time_since_boot={time_since_boot}")
    return {"status": "anchored", "wall_time": wall_now.isoformat()}

@app.post("/data")
async def receive_data(request: Request):
    raw = await request.body()
    print(f"Raw data body: {raw}")
    try:
        body = json.loads(raw)
    except Exception as e:
        print(f"JSON parse error: {e}")
        raise HTTPException(status_code=400, detail=f"Bad JSON: {e}")

    ecu_serial_number = body.get("ecu_serial_number")
    time_since_boot = body.get("time_since_boot")
    sample_rate = body.get("sample_rate")
    voltage = body.get("voltage", [])
    current = body.get("current", [])

    if any(v is None for v in [ecu_serial_number, time_since_boot, sample_rate]):
        print(f"Missing fields, got: {body}")
        raise HTTPException(status_code=400, detail=f"Missing fields")

    anchor = get_anchor(ecu_serial_number)
    first_sample_wall = time_since_boot_to_wall(anchor, time_since_boot)
    sample_interval = timedelta(seconds=1.0 / sample_rate)

    samples = []
    for i in range(len(voltage)):
        samples.append({
            "timestamp": (first_sample_wall + sample_interval * i).isoformat(),
            "voltage":   voltage[i],
            "current":   current[i],
        })

    print(
        f"ECU={ecu_serial_number}  "
        f"first={first_sample_wall.isoformat()}  "
        f"rate={sample_rate}Hz  "
        f"n={len(samples)}  "
        f"V={voltage}  "
        f"I={current}"
    )
    return {
        "status": "ok",
        "samples_received": len(samples),
        "first_sample_time": first_sample_wall.isoformat(),
    }

if __name__ == "__main__":
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=8000,
        http="h11",
        timeout_keep_alive=30
    )