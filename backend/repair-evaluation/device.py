"""Agent-editable repair structure. No file IO, solver calls or yield calculation.

This device treats each sample as an independent array. One spare repairs an
entire row/column; column pools cannot lend spares to other groups. For banks,
segments, shared fuses, etc., replace build_model and describe together.
"""
from __future__ import annotations

from collections import defaultdict

from models import Action, RepairModel, Sample, integer, keys

DEVICE_API_VERSION = 1


def validate_config(config: dict) -> None:
    keys(config, {"spare_rows", "column_groups", "spare_cols_per_group",
                  "column_group_offset"}, set(), "device")
    integer(config["spare_rows"], "spare_rows")
    groups = integer(config["column_groups"], "column_groups", 1)
    counts = config["spare_cols_per_group"]
    if not isinstance(counts, list) or len(counts) != groups:
        raise ValueError("spare_cols_per_group must contain one capacity per group")
    for i, count in enumerate(counts):
        integer(count, f"spare_cols_per_group[{i}]")
    offset = integer(config["column_group_offset"], "column_group_offset")
    if offset >= groups:
        raise ValueError("column_group_offset must be smaller than column_groups")


def describe(config: dict) -> dict:
    validate_config(config)
    return {
        "structure": "independent array; full-row and full-column replacement; no ECC",
        "row_pool": config["spare_rows"],
        "column_pool_capacities": config["spare_cols_per_group"],
        "column_rule": f"group = (zero_based_col + {config['column_group_offset']}) "
                       f"% {config['column_groups']}",
        "resource_scope": "capacities reset for each roster sample; no cross-group borrowing",
        "pass_rule": "every distinct fail coordinate is covered",
    }


def build_model(sample: Sample, config: dict) -> RepairModel:
    validate_config(config)
    groups = config["column_groups"]
    capacities = {"row": config["spare_rows"], **{
        f"col_group_{g}": count
        for g, count in enumerate(config["spare_cols_per_group"])
    }}
    rows: dict[int, set] = defaultdict(set)
    cols: dict[int, set] = defaultdict(set)
    for row, col in sample.fails:
        rows[row].add((row, col))
        cols[col].add((row, col))
    # One binary decision per affected line, not one decision per bad cell.
    # Unaffected lines cannot help this device and therefore need no variable.
    actions = [Action(f"row:{row}", frozenset(cells), {"row": 1})
               for row, cells in sorted(rows.items())]
    for col, cells in sorted(cols.items()):
        group = (col + config["column_group_offset"]) % groups
        actions.append(Action(f"col:{col}", frozenset(cells), {f"col_group_{group}": 1}))
    return RepairModel(capacities, tuple(actions))
