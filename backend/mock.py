# mock_ws_server.py
import asyncio, json, random, time
import websockets

ECU_IDS = [1, 2]

async def handler(websocket):
    # get path from connection object
    path = websocket.request.path  
    ecu_id = int(path.strip("/ws/") or 1)
    frame_id = 1000
    while True:
        frame = {
            "id": frame_id,
            "ecu_id": ecu_id,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "avg_voltage": round(random.uniform(0.0, 60.0), 2),
            "avg_current": round(random.uniform(-100.0, 100.0), 2),
            "energy": round(random.uniform(0.5, 0.7), 3),
        }
        await websocket.send(json.dumps(frame))
        frame_id += 1
        await asyncio.sleep(0.1)

async def main():
    async with websockets.serve(handler, "localhost", 8765):
        print("Mock WebSocket server running on ws://localhost:8765")
        await asyncio.Future()  

asyncio.run(main())