from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.ecu import ECU, VehicleClass, VehicleType
from app.models.energy_frame import EnergyFrame
from app.schemas.scoring import (
    ScoringBracketResponse,
    ScoringEnergySource,
    ScoringEntryResponse,
    ScoringEventResponse,
    ScoringMetric,
    ScoringStatus,
)


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
