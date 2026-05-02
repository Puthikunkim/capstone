# Unit tests for team management endpoints (routers/teams.py).

from app.models.ecu import ECU, VehicleClass, VehicleType
from app.models.team import Team


def make_ecu(db, serial_number=1001):
    ecu = ECU(
        serial_number=serial_number,
        team_number=0,
        vehicle_class=VehicleClass.STANDARD,
        vehicle_type=VehicleType.BIKE,
        power_limit_watts=350.0,
    )
    db.add(ecu)
    db.commit()
    db.refresh(ecu)
    return ecu


def make_team(db, name="Team Alpha", vehicle_class="Standard", vehicle_type="bike"):
    team = Team(
        name=name,
        vehicle_class=VehicleClass(vehicle_class),
        vehicle_type=VehicleType(vehicle_type),
    )
    db.add(team)
    db.commit()
    db.refresh(team)
    return team


class TestCreateTeam:
    def test_creates_team_with_valid_payload(self, client):
        resp = client.post("/api/teams/", json={
            "name": "Team Alpha",
            "vehicle_class": "Standard",
            "vehicle_type": "bike",
        })
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Team Alpha"
        assert body["vehicle_class"] == "Standard"
        assert body["vehicle_type"] == "bike"
        assert "id" in body

    def test_returns_409_on_duplicate_name(self, client, db):
        make_team(db, name="Team Alpha")
        resp = client.post("/api/teams/", json={
            "name": "Team Alpha",
            "vehicle_class": "Standard",
            "vehicle_type": "bike",
        })
        assert resp.status_code == 409

    def test_rejects_blank_name(self, client):
        resp = client.post("/api/teams/", json={
            "name": "   ",
            "vehicle_class": "Standard",
            "vehicle_type": "bike",
        })
        assert resp.status_code == 422

    def test_creates_team_with_competition_id(self, client, db):
        from app.models.competition import Competition
        comp = Competition(name="Round 1")
        db.add(comp)
        db.commit()
        db.refresh(comp)

        resp = client.post("/api/teams/", json={
            "name": "Team Beta",
            "vehicle_class": "Open",
            "vehicle_type": "kart",
            "competition_id": comp.id,
        })
        assert resp.status_code == 201
        assert resp.json()["competition_id"] == comp.id


class TestListTeams:
    def test_returns_empty_list_when_no_teams(self, client):
        resp = client.get("/api/teams/")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_all_teams(self, client, db):
        make_team(db, name="Team A")
        make_team(db, name="Team B")
        resp = client.get("/api/teams/")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_returns_teams_in_alphabetical_order(self, client, db):
        make_team(db, name="Zebra Team")
        make_team(db, name="Alpha Team")
        names = [t["name"] for t in client.get("/api/teams/").json()]
        assert names == sorted(names)


class TestGetTeamDetail:
    def test_returns_team_by_id(self, client, db):
        team = make_team(db, name="Team Alpha")
        resp = client.get(f"/api/teams/{team.id}")
        assert resp.status_code == 200
        assert resp.json()["name"] == "Team Alpha"

    def test_returns_404_when_not_found(self, client):
        resp = client.get("/api/teams/9999")
        assert resp.status_code == 404

    def test_includes_assigned_ecu_ids(self, client, db):
        team = make_team(db)
        ecu = make_ecu(db)
        ecu.team_id = team.id
        db.commit()

        resp = client.get(f"/api/teams/{team.id}")
        assert resp.status_code == 200
        assert ecu.id in resp.json()["assigned_ecu_ids"]


class TestListTeamEcus:
    def test_returns_404_for_missing_team(self, client):
        resp = client.get("/api/teams/9999/ecus")
        assert resp.status_code == 404

    def test_returns_empty_list_when_no_ecus_assigned(self, client, db):
        team = make_team(db)
        resp = client.get(f"/api/teams/{team.id}/ecus")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_ecus_assigned_to_team(self, client, db):
        team = make_team(db)
        ecu = make_ecu(db)
        ecu.team_id = team.id
        db.commit()

        resp = client.get(f"/api/teams/{team.id}/ecus")
        assert resp.status_code == 200
        assert len(resp.json()) == 1
        assert resp.json()[0]["id"] == ecu.id


class TestListAvailableEcus:
    def test_returns_unassigned_ecus(self, client, db):
        make_ecu(db, serial_number=1001)
        resp = client.get("/api/teams/available-ecus")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_excludes_assigned_ecus(self, client, db):
        team = make_team(db)
        assigned = make_ecu(db, serial_number=1001)
        assigned.team_id = team.id
        db.commit()
        make_ecu(db, serial_number=1002)

        resp = client.get("/api/teams/available-ecus")
        assert resp.status_code == 200
        serials = [e["serial_number"] for e in resp.json()]
        assert 1002 in serials
        assert 1001 not in serials

    def test_returns_empty_list_when_all_assigned(self, client, db):
        team = make_team(db)
        ecu = make_ecu(db)
        ecu.team_id = team.id
        db.commit()

        resp = client.get("/api/teams/available-ecus")
        assert resp.status_code == 200
        assert resp.json() == []


class TestAssignEcu:
    def test_assigns_ecu_to_team(self, client, db):
        team = make_team(db)
        ecu = make_ecu(db)
        resp = client.post(f"/api/teams/{team.id}/assign/{ecu.id}")
        assert resp.status_code == 200
        assert resp.json()["team_id"] == team.id

    def test_syncs_ecu_fields_from_team(self, client, db):
        team = make_team(db, vehicle_class="Open", vehicle_type="kart")
        ecu = make_ecu(db)
        resp = client.post(f"/api/teams/{team.id}/assign/{ecu.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["vehicle_class"] == "Open"
        assert body["vehicle_type"] == "kart"

    def test_returns_404_when_team_not_found(self, client, db):
        ecu = make_ecu(db)
        resp = client.post(f"/api/teams/9999/assign/{ecu.id}")
        assert resp.status_code == 404

    def test_returns_404_when_ecu_not_found(self, client, db):
        team = make_team(db)
        resp = client.post(f"/api/teams/{team.id}/assign/9999")
        assert resp.status_code == 404

    def test_returns_409_when_ecu_already_assigned_to_different_team(self, client, db):
        team_a = make_team(db, name="Team A")
        team_b = make_team(db, name="Team B")
        ecu = make_ecu(db)
        ecu.team_id = team_a.id
        db.commit()

        resp = client.post(f"/api/teams/{team_b.id}/assign/{ecu.id}")
        assert resp.status_code == 409


class TestUnassignEcu:
    def test_unassigns_ecu_from_team(self, client, db):
        team = make_team(db)
        ecu = make_ecu(db)
        ecu.team_id = team.id
        db.commit()

        resp = client.post(f"/api/teams/{team.id}/unassign/{ecu.id}")
        assert resp.status_code == 200
        assert resp.json()["team_id"] is None

    def test_returns_404_when_team_not_found(self, client, db):
        ecu = make_ecu(db)
        resp = client.post(f"/api/teams/9999/unassign/{ecu.id}")
        assert resp.status_code == 404

    def test_returns_404_when_ecu_not_found(self, client, db):
        team = make_team(db)
        resp = client.post(f"/api/teams/{team.id}/unassign/9999")
        assert resp.status_code == 404

    def test_returns_409_when_ecu_not_assigned(self, client, db):
        team = make_team(db)
        ecu = make_ecu(db)
        resp = client.post(f"/api/teams/{team.id}/unassign/{ecu.id}")
        assert resp.status_code == 409

    def test_returns_409_when_ecu_assigned_to_different_team(self, client, db):
        team_a = make_team(db, name="Team A")
        team_b = make_team(db, name="Team B")
        ecu = make_ecu(db)
        ecu.team_id = team_a.id
        db.commit()

        resp = client.post(f"/api/teams/{team_b.id}/unassign/{ecu.id}")
        assert resp.status_code == 409
