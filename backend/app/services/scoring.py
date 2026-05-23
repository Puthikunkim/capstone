from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.ecu import ECU, VehicleClass, VehicleType
from app.models.energy_frame import EnergyFrame
from app.models.event_participant import EventParticipant
from app.models.team import Team
from app.schemas.scoring import (
    EventLeaderboardResponse,
    LeaderboardEntry,
    LeaderboardStatus,
    ScoringBracketResponse,
    ScoringEnergySource,
    ScoringEntryResponse,
    ScoringEventResponse,
    ScoringMetric,
    ScoringStatus,
)

MAX_LEADERBOARD_WINDOW_SECONDS = 30.0


@dataclass(slots=True)
class _Aggregate:
    frame_count: int
    transmitted_energy_wh: float
    integrated_energy_wh: float
    avg_power_watts: float
    elapsed_seconds: float


def _to_utc(timestamp: datetime) -> datetime:
    if timestamp.tzinfo is None:
        return timestamp.replace(tzinfo=timezone.utc)
    return timestamp.astimezone(timezone.utc)


def _frame_mean_power(frame: EnergyFrame) -> float:
    samples = frame.power_samples
    if samples:
        return sum(samples) / len(samples)
    return float(frame.power_watts)


def _metric_value(
    aggregate: _Aggregate,
    metric: ScoringMetric,
    energy_source: ScoringEnergySource,
) -> float:
    if metric == ScoringMetric.AVG_POWER_WATTS:
        return aggregate.avg_power_watts
    if metric == ScoringMetric.ELAPSED_SECONDS:
        return aggregate.elapsed_seconds
    if energy_source == ScoringEnergySource.INTEGRATED_POWER:
        return aggregate.integrated_energy_wh
    return aggregate.transmitted_energy_wh


def _interpolated_score(value: float, best: float, worst: float) -> float:
    if abs(worst - best) < 1e-9:
        return 100.0

    score = ((worst - value) / (worst - best)) * 75.0 + 25.0
    return round(max(25.0, min(100.0, score)), 2)


def _integrated_energy_wh(frames: list[EnergyFrame]) -> float:
    if len(frames) < 2:
        return 0.0

    integrated_wh = 0.0
    for previous, current in zip(frames, frames[1:]):
        previous_ts = _to_utc(previous.timestamp)
        current_ts = _to_utc(current.timestamp)
        delta_seconds = max(0.0, (current_ts - previous_ts).total_seconds())
        avg_power = (_frame_mean_power(previous) + _frame_mean_power(current)) / 2.0
        integrated_wh += (avg_power * delta_seconds) / 3600.0

    return integrated_wh


def _load_aggregates(db: Session, start: datetime, end: datetime) -> dict[int, _Aggregate]:
    stmt = (
        select(
            EnergyFrame,
        )
        .where(EnergyFrame.timestamp >= start, EnergyFrame.timestamp <= end)
        .order_by(EnergyFrame.ecu_id.asc(), EnergyFrame.timestamp.asc())
    )

    frames_by_ecu: dict[int, list[EnergyFrame]] = defaultdict(list)
    for frame in db.scalars(stmt):
        frames_by_ecu[frame.ecu_id].append(frame)

    aggregates: dict[int, _Aggregate] = {}
    for ecu_id, frames in frames_by_ecu.items():
        first_seen = _to_utc(frames[0].timestamp)
        last_seen = _to_utc(frames[-1].timestamp)
        elapsed_seconds = max(0.0, (last_seen - first_seen).total_seconds())
        frame_count = len(frames)
        transmitted_energy_wh = sum(float(frame.energy) for frame in frames)
        avg_power_watts = sum(_frame_mean_power(frame) for frame in frames) / frame_count
        integrated_energy_wh = _integrated_energy_wh(frames)

        aggregates[int(ecu_id)] = _Aggregate(
            frame_count=frame_count,
            transmitted_energy_wh=float(transmitted_energy_wh),
            integrated_energy_wh=float(integrated_energy_wh),
            avg_power_watts=float(avg_power_watts),
            elapsed_seconds=float(elapsed_seconds),
        )

    return aggregates


def score_event_from_energy(
    db: Session,
    event_id: str,
    start: datetime,
    end: datetime,
    metric: ScoringMetric,
    include_inactive: bool,
    energy_source: ScoringEnergySource = ScoringEnergySource.TRANSMITTED,
) -> ScoringEventResponse:
    start_utc = _to_utc(start)
    end_utc = _to_utc(end)

    ecus = list(db.scalars(select(ECU).order_by(ECU.team_number.asc(), ECU.mac_address.asc().nullslast())).all())
    aggregates = _load_aggregates(db, start_utc, end_utc)

    bracket_map: dict[tuple[VehicleClass, VehicleType], list[ECU]] = defaultdict(list)
    for ecu in ecus:
        bracket_map[(ecu.vehicle_class, ecu.vehicle_type)].append(ecu)

    brackets: list[ScoringBracketResponse] = []

    for (vehicle_class, vehicle_type), bracket_ecus in bracket_map.items():
        scored_candidates: list[tuple[ECU, _Aggregate, float]] = []
        dnf_entries: list[ScoringEntryResponse] = []

        for ecu in bracket_ecus:
            aggregate = aggregates.get(ecu.id)
            if aggregate is None or aggregate.frame_count <= 0:
                if include_inactive:
                    dnf_entries.append(
                        ScoringEntryResponse(
                            rank=None,
                            ecu_id=ecu.id,
                            mac_address=ecu.mac_address,
                            team_number=ecu.team_number,
                            status=ScoringStatus.DNF,
                            score=0.0,
                            metric_value=None,
                            total_energy_wh=None,
                            avg_power_watts=None,
                            elapsed_seconds=None,
                            frame_count=0,
                        )
                    )
                continue

            scored_candidates.append((ecu, aggregate, _metric_value(aggregate, metric, energy_source)))

        entries: list[ScoringEntryResponse] = []

        if scored_candidates:
            scored_candidates.sort(key=lambda item: (item[2], item[0].team_number, item[0].mac_address or ""))
            best_metric = scored_candidates[0][2]
            worst_metric = scored_candidates[-1][2]

            previous_metric: float | None = None
            current_rank = 0
            for idx, (ecu, aggregate, metric_value) in enumerate(scored_candidates, start=1):
                if previous_metric is None or abs(metric_value - previous_metric) > 1e-9:
                    current_rank = idx
                previous_metric = metric_value

                entries.append(
                    ScoringEntryResponse(
                        rank=current_rank,
                        ecu_id=ecu.id,
                        mac_address=ecu.mac_address,
                        team_number=ecu.team_number,
                        status=ScoringStatus.SCORED,
                        score=_interpolated_score(metric_value, best_metric, worst_metric),
                        metric_value=round(metric_value, 4),
                        total_energy_wh=round(
                            _metric_value(aggregate, ScoringMetric.ENERGY_WH, energy_source),
                            4,
                        ),
                        avg_power_watts=round(aggregate.avg_power_watts, 4),
                        elapsed_seconds=round(aggregate.elapsed_seconds, 3),
                        frame_count=aggregate.frame_count,
                    )
                )

        if include_inactive and dnf_entries:
            entries.extend(dnf_entries)

        if entries:
            brackets.append(
                ScoringBracketResponse(
                    vehicle_class=vehicle_class,
                    vehicle_type=vehicle_type,
                    entries=entries,
                )
            )

    return ScoringEventResponse(
        event_id=event_id,
        start=start_utc,
        end=end_utc,
        metric=metric,
        energy_source=energy_source,
        brackets=brackets,
    )


def _frames_for_window(
    db: Session,
    ecu_id: int,
    start_utc: datetime,
    end_utc: datetime,
) -> list[EnergyFrame]:
    return list(db.scalars(
        select(EnergyFrame)
        .where(
            EnergyFrame.ecu_id == ecu_id,
            EnergyFrame.timestamp >= start_utc,
            EnergyFrame.timestamp <= end_utc,
        )
        .order_by(EnergyFrame.timestamp.asc())
    ).all())


def compute_event_leaderboard(db: Session, event_id: int) -> EventLeaderboardResponse:
    """Rank teams by integrated energy over each team's measurement window (≤ 30 s).

    Window source:
      - EventParticipant has start + duration → use that (capped at 30 s)
      - No explicit timing → use the most recent 30 s of ECU frames

    Teams with no ECU are excluded.
    Teams with ECU but no frames appear as PENDING.
    Any team with at least one frame gets a SCORED entry.
    """
    participants = list(db.scalars(
        select(EventParticipant).where(EventParticipant.event_id == event_id)
    ).all())

    scored: list[LeaderboardEntry] = []
    pending: list[LeaderboardEntry] = []

    for p in participants:
        team = db.get(Team, p.team_id)
        if team is None:
            continue

        ecu = db.scalar(select(ECU).where(ECU.team_id == p.team_id).limit(1))

        # No ECU → exclude entirely
        if ecu is None:
            continue

        is_live = bool(ecu.is_connected)

        # Determine the measurement window
        if p.start is not None:
            window = min(
                p.duration_seconds if p.duration_seconds is not None else MAX_LEADERBOARD_WINDOW_SECONDS,
                MAX_LEADERBOARD_WINDOW_SECONDS,
            )
            start_utc = _to_utc(p.start)
            end_utc = start_utc + timedelta(seconds=window)
            frames = _frames_for_window(db, ecu.id, start_utc, end_utc)
        else:
            # No explicit timing — use the most recent 30 s of available frames
            latest_frame = db.scalar(
                select(EnergyFrame)
                .where(EnergyFrame.ecu_id == ecu.id)
                .order_by(EnergyFrame.timestamp.desc())
                .limit(1)
            )
            if latest_frame is None:
                pending.append(LeaderboardEntry(
                    rank=None, team_id=team.id, team_name=team.name,
                    ecu_id=ecu.id, mac_address=ecu.mac_address,
                    energy_wh=None, avg_power_watts=None,
                    duration_seconds=None, frame_count=0,
                    status=LeaderboardStatus.PENDING,
                    is_live=is_live,
                    last_reading_at=None,
                ))
                continue

            end_utc = _to_utc(latest_frame.timestamp)
            start_utc = end_utc - timedelta(seconds=MAX_LEADERBOARD_WINDOW_SECONDS)
            frames = _frames_for_window(db, ecu.id, start_utc, end_utc)

        if not frames:
            pending.append(LeaderboardEntry(
                rank=None, team_id=team.id, team_name=team.name,
                ecu_id=ecu.id, mac_address=ecu.mac_address,
                energy_wh=None, avg_power_watts=None,
                duration_seconds=None, frame_count=0,
                status=LeaderboardStatus.PENDING,
                is_live=is_live,
                last_reading_at=None,
            ))
            continue

        energy_wh = _integrated_energy_wh(frames)
        avg_power = sum(_frame_mean_power(f) for f in frames) / len(frames)
        actual_duration = max(
            0.0,
            (_to_utc(frames[-1].timestamp) - _to_utc(frames[0].timestamp)).total_seconds(),
        )
        last_reading_at = _to_utc(frames[-1].timestamp)

        scored.append(LeaderboardEntry(
            rank=None, team_id=team.id, team_name=team.name,
            ecu_id=ecu.id, mac_address=ecu.mac_address,
            energy_wh=round(energy_wh, 4),
            avg_power_watts=round(avg_power, 2),
            duration_seconds=round(actual_duration, 1),
            frame_count=len(frames),
            status=LeaderboardStatus.SCORED,
            is_live=is_live,
            last_reading_at=last_reading_at,
        ))

    # Lower energy = more efficient = better rank
    scored.sort(key=lambda e: (e.energy_wh, e.team_name))
    rank = 0
    prev: float | None = None
    for i, entry in enumerate(scored, 1):
        if prev is None or abs(entry.energy_wh - prev) > 1e-9:
            rank = i
        entry.rank = rank
        prev = entry.energy_wh

    return EventLeaderboardResponse(
        event_id=event_id,
        max_window_seconds=int(MAX_LEADERBOARD_WINDOW_SECONDS),
        entries=scored + pending,
    )
