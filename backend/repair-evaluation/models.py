"""Solver-independent contract shared by the framework and editable device."""
from __future__ import annotations

from dataclasses import dataclass, field

Coordinate = tuple[int, int]


@dataclass(frozen=True)
class Sample:
    group: str
    sample_id: str
    rows: int
    cols: int
    fails: frozenset[Coordinate]  # Always normalized to zero-based coordinates.


@dataclass(frozen=True)
class Action:
    id: str
    covers: frozenset[Coordinate]
    uses: dict[str, int]  # Resource pool -> number consumed by this action.


@dataclass(frozen=True)
class LinearRule:
    """Optional coupling: lower <= sum(coefficients[id] * selected[id]) <= upper."""
    id: str
    coefficients: dict[str, int]
    lower: int | None = None
    upper: int | None = None


@dataclass(frozen=True)
class RepairModel:
    capacities: dict[str, int]
    actions: tuple[Action, ...]
    rules: tuple[LinearRule, ...] = field(default_factory=tuple)


def integer(value: object, name: str, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise ValueError(f"{name} must be an integer >= {minimum}")
    return value


def keys(value: object, required: set[str], optional: set[str], name: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be an object")
    if required - value.keys() or value.keys() - required - optional:
        raise ValueError(f"{name}: missing {sorted(required - value.keys())}; "
                         f"unknown {sorted(value.keys() - required - optional)}")
    return value
