from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.ecu import ECUResponse
from app.schemas.team import TeamCreate, TeamDetailResponse, TeamResponse
from app.services.storage import get_ecu
from app.services.teams import (
    ECUAssignmentConflictError,
    TeamNameConflictError,
    assign_team_to_ecu,
    create_team,
    get_team,
    list_team_ecus,
    list_teams,
    list_unassigned_ecus,
    unassign_team_from_ecu,
)

router = APIRouter(prefix="/teams", tags=["teams"])


@router.post("/", response_model=TeamResponse, status_code=status.HTTP_201_CREATED)
def create_team_entry(payload: TeamCreate, db: Session = Depends(get_db)):
    try:
        return create_team(db, payload)
    except TeamNameConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/", response_model=list[TeamResponse])
def list_team_entries(db: Session = Depends(get_db)):
    return list_teams(db)


@router.get("/available-ecus", response_model=list[ECUResponse])
def list_available_ecus(db: Session = Depends(get_db)):
    return list_unassigned_ecus(db)


@router.get("/{team_id}", response_model=TeamDetailResponse)
def get_team_entry(team_id: int, db: Session = Depends(get_db)):
    team = get_team(db, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")

    assigned_ecus = list_team_ecus(db, team_id)
    return TeamDetailResponse(
        id=team.id,
        name=team.name,
        vehicle_class=team.vehicle_class,
        vehicle_type=team.vehicle_type,
        assigned_ecu_ids=[ecu.id for ecu in assigned_ecus],
    )


@router.get("/{team_id}/ecus", response_model=list[ECUResponse])
def list_ecus_for_team(team_id: int, db: Session = Depends(get_db)):
    team = get_team(db, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    return list_team_ecus(db, team_id)


@router.post("/{team_id}/assign/{ecu_id}", response_model=ECUResponse)
def assign_ecu(team_id: int, ecu_id: int, db: Session = Depends(get_db)):
    team = get_team(db, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")

    ecu = get_ecu(db, ecu_id)
    if ecu is None:
        raise HTTPException(status_code=404, detail="ECU not found")

    try:
        return assign_team_to_ecu(db, team, ecu)
    except ECUAssignmentConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{team_id}/unassign/{ecu_id}", response_model=ECUResponse)
def unassign_ecu(team_id: int, ecu_id: int, db: Session = Depends(get_db)):
    team = get_team(db, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")

    ecu = get_ecu(db, ecu_id)
    if ecu is None:
        raise HTTPException(status_code=404, detail="ECU not found")

    try:
        return unassign_team_from_ecu(db, team, ecu)
    except ECUAssignmentConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
