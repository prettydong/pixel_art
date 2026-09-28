"""CCR repair device for one region per sample.

Each region has one global spare-row pool shared by all segments. A CCR spare is local to a segment and
repairs one original column address inside that segment; it never folds a
column address, offsets groups, or lends capacity to another segment.
"""
from __future__ import annotations

from collections import defaultdict

from models import Action, RepairModel, Sample, integer, keys

DEVICE_API_VERSION = 1


def validate_config(config: dict) -> None:
    keys(config, {"spare_rows", "ccr_groups_per_segment", "ccr_spares_per_group",
                  "row_layout"}, set(), "device")
    integer(config["spare_rows"], "spare_rows")
    groups = integer(config["ccr_groups_per_segment"], "ccr_groups_per_segment", 1)
    capacities = config["ccr_spares_per_group"]
    if not isinstance(capacities, list) or len(capacities) != groups:
        raise ValueError("ccr_spares_per_group must contain one capacity per CCR group")
    for index, capacity in enumerate(capacities):
        integer(capacity, f"ccr_spares_per_group[{index}]")

    layout = keys(config["row_layout"], {"section_count", "sections_per_segment",
                                          "section_group_size", "subsection_size",
                                          "subsections_per_group"}, set(), "row_layout")
    for name, value in layout.items():
        integer(value, f"row_layout.{name}", 1)
    section_count = layout["section_count"]
    if section_count % layout["subsections_per_group"]:
        raise ValueError("row_layout.section_count must be divisible by subsections_per_group")
    if section_count % layout["sections_per_segment"]:
        raise ValueError("row_layout.section_count must be divisible by sections_per_segment")
    if layout["section_group_size"] > (layout["subsection_size"] *
                                        layout["subsections_per_group"]):
        raise ValueError("row_layout.section_group_size must not exceed "
                         "subsection_size * subsections_per_group")


def _derived(config: dict) -> tuple[int, int]:
    layout = config["row_layout"]
    return ((layout["section_count"] // layout["subsections_per_group"]) *
            layout["section_group_size"],
            layout["section_count"] // layout["sections_per_segment"])


def validate_array(rows: int, cols: int, config: dict) -> None:
    """Validate an experiment array or a loaded Sample against this device."""
    validate_config(config)
    integer(rows, "array.rows", 1)
    integer(cols, "array.cols", 1)
    expected_rows, _ = _derived(config)
    if rows != expected_rows:
        raise ValueError(f"array.rows must equal the CCR layout's expected row count "
                         f"({expected_rows}), got {rows}")


def _segment_for_row(row: int, config: dict) -> int:
    layout = config["row_layout"]
    section_group = row // layout["section_group_size"]
    subsection = ((row % layout["section_group_size"]) // layout["subsection_size"]
                  + section_group * layout["subsections_per_group"])
    return subsection // layout["sections_per_segment"]


def describe(config: dict) -> dict:
    validate_config(config)
    expected_rows, segment_count = _derived(config)
    layout = config["row_layout"]
    return {
        "structure": "one region per sample; region-wide row spares shared by segments and segment-local CCR column spares",
        "evaluation_unit_meaning": "sample is one region; repair_yield is a region yield",
        "row_pool": {"key": "region_rows", "capacity": config["spare_rows"],
                     "coverage": "all fails at one original row across all columns in the region",
                     "scope": "one global row capacity shared by all segments of this region; no cross-region sharing"},
        "ccr": {"segment_count": segment_count,
                "groups_per_segment": config["ccr_groups_per_segment"],
                "capacities_per_segment": config["ccr_spares_per_group"],
                "pool_key": "segment_{segment}_ccr_{group}",
                "group_rule": "group = zero_based_col % ccr_groups_per_segment",
                "coverage": "all fails at one original column within one segment",
                "scope": "each segment has an independent repeated CCR capacity; no borrowing"},
        "row_mapping": {"name": "smart-eval section/subsection mapping",
                        "section_group": "row // section_group_size",
                        "subsection": "(row % section_group_size) // subsection_size + "
                                      "section_group * subsections_per_group",
                        "segment": "subsection // sections_per_segment",
                        "layout": layout, "expected_rows": expected_rows},
        "array_requirements": {"rows": expected_rows, "cols": "positive integer"},
        "not_modelled": ["LCR", "column address folding", "column offset", "ECC",
                          "cross-region resource sharing", "cross-segment column resource sharing"],
        "pass_rule": "every distinct fail coordinate is covered",
    }


def build_model(sample: Sample, config: dict) -> RepairModel:
    validate_array(sample.rows, sample.cols, config)
    capacities: dict[str, int] = {"region_rows": config["spare_rows"]}
    rows: dict[int, set] = defaultdict(set)
    segmented_columns: dict[tuple[int, int], set] = defaultdict(set)
    for row, col in sample.fails:
        segment = _segment_for_row(row, config)
        rows[row].add((row, col))
        segmented_columns[(segment, col)].add((row, col))
    actions = [Action(f"row:{row}", frozenset(cells), {"region_rows": 1})
               for row, cells in sorted(rows.items())]
    groups = config["ccr_groups_per_segment"]
    per_group = config["ccr_spares_per_group"]
    for (segment, col), cells in sorted(segmented_columns.items()):
        group = col % groups
        pool = f"segment_{segment}_ccr_{group}"
        capacities.setdefault(pool, per_group[group])
        actions.append(Action(f"segment:{segment}:col:{col}", frozenset(cells), {pool: 1}))
    return RepairModel(capacities, tuple(actions))
