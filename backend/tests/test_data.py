# Unit tests for the /data endpoint (routers/data.py).

BASE_FRAME = {
    "ecu_serial": 1001,
    "timestamp": "2024-01-01T12:00:00Z",
    "voltage_samples": [2048],
    "current_samples": [2048],  # ~0 A → near-zero power, no violation
    "energy": -3.0,
}


class TestIngestFrame:
    def test_returns_200_and_frame_id(self, client):
        resp = client.post("/api/data", json=BASE_FRAME)
        assert resp.status_code == 200
        assert "id" in resp.json()

    def test_creates_ecu_automatically(self, client):
        client.post("/api/data", json=BASE_FRAME)
        ecus = client.get("/api/ecu/").json()
        assert any(e["serial_number"] == 1001 for e in ecus)

    def test_response_contains_avg_voltage(self, client):
        resp = client.post("/api/data", json=BASE_FRAME)
        assert resp.json()["avg_voltage"] > 0

    def test_response_contains_power_watts(self, client):
        resp = client.post("/api/data", json=BASE_FRAME)
        assert "power_watts" in resp.json()

    def test_duplicate_timestamp_returns_same_frame_id(self, client):
        id1 = client.post("/api/data", json=BASE_FRAME).json()["id"]
        id2 = client.post("/api/data", json=BASE_FRAME).json()["id"]
        assert id1 == id2

    def test_different_timestamp_creates_new_frame(self, client):
        frame2 = {**BASE_FRAME, "timestamp": "2024-01-01T12:00:01Z"}
        id1 = client.post("/api/data", json=BASE_FRAME).json()["id"]
        id2 = client.post("/api/data", json=frame2).json()["id"]
        assert id1 != id2


class TestIngestBatch:
    def test_returns_200(self, client):
        payload = {"frames": [BASE_FRAME]}
        assert client.post("/api/data/batch", json=payload).status_code == 200

    def test_received_count_matches_input(self, client):
        frames = [BASE_FRAME, {**BASE_FRAME, "timestamp": "2024-01-01T12:00:01Z"}]
        resp = client.post("/api/data/batch", json={"frames": frames}).json()
        assert resp["received"] == 2

    def test_inserted_count_matches_new_frames(self, client):
        frames = [BASE_FRAME, {**BASE_FRAME, "timestamp": "2024-01-01T12:00:01Z"}]
        resp = client.post("/api/data/batch", json={"frames": frames}).json()
        assert resp["inserted"] == 2

    def test_counts_duplicates_correctly(self, client):
        client.post("/api/data", json=BASE_FRAME)
        resp = client.post("/api/data/batch", json={"frames": [BASE_FRAME]}).json()
        assert resp["duplicates"] == 1
        assert resp["inserted"] == 0

    def test_inserts_out_of_order_frames_in_chronological_order(self, client):
        frames = [
            {**BASE_FRAME, "timestamp": "2024-01-01T12:00:03Z"},
            {**BASE_FRAME, "timestamp": "2024-01-01T12:00:01Z"},
            {**BASE_FRAME, "timestamp": "2024-01-01T12:00:02Z"},
        ]
        resp = client.post("/api/data/batch", json={"frames": frames}).json()
        timestamps = [f["timestamp"] for f in resp["frames"]]
        assert timestamps == sorted(timestamps)

    def test_empty_batch_returns_zero_counts(self, client):
        resp = client.post("/api/data/batch", json={"frames": []}).json()
        assert resp["received"] == 0
        assert resp["inserted"] == 0
        assert resp["duplicates"] == 0
