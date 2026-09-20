"""Strict CSV ingestion; a separate roster keeps zero-fail samples in the yield."""
from __future__ import annotations

import csv
import hashlib
import json
import math
from pathlib import Path

from models import Sample, integer, keys


def read_json(path: Path) -> dict:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate JSON key: {key}")
            result[key] = value
        return result
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique)


def fingerprint(path: Path) -> dict:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return {"path": str(path.resolve()), "sha256": digest.hexdigest()}


def validate_spec(spec: dict) -> None:
    keys(spec, {"schema_version", "data_kind", "evaluation_unit", "inputs", "array",
                "device", "solver"}, set(), "experiment")
    if type(spec["schema_version"]) is not int or spec["schema_version"] != 1:
        raise ValueError("schema_version must be 1")
    if spec["data_kind"] not in ("measured", "synthetic"):
        raise ValueError("data_kind must be measured or synthetic")
    if spec["evaluation_unit"] not in ("device", "sample"):
        raise ValueError("evaluation_unit must be device or sample")
    array = keys(spec["array"], {"rows", "cols", "coordinate_base"}, set(), "array")
    integer(array["rows"], "array.rows", 1)
    integer(array["cols"], "array.cols", 1)
    if integer(array["coordinate_base"], "coordinate_base") not in (0, 1):
        raise ValueError("coordinate_base must be 0 or 1")
    inputs = keys(spec["inputs"], {"roster", "fails", "roster_columns", "fail_columns"},
                  set(), "inputs")
    if not isinstance(inputs["roster"], str) or not inputs["roster"].strip():
        raise ValueError("inputs.roster must be a path")
    if not isinstance(inputs["fails"], list) or not inputs["fails"] or any(
            not isinstance(p, str) or not p.strip() for p in inputs["fails"]):
        raise ValueError("inputs.fails must be a nonempty array of CSV paths")
    for field, required, optional in [
        ("roster_columns", {"group", "sample_id"}, {"fail_count"}),
        ("fail_columns", {"group", "sample_id", "row", "col"}, set()),
    ]:
        mapping = keys(inputs[field], required, optional, field)
        if any(not isinstance(v, str) or not v.strip() for v in mapping.values()):
            raise ValueError(f"{field} must map to nonempty CSV column names")
        if len(set(mapping.values())) != len(mapping):
            raise ValueError(f"{field} cannot map two fields to the same column")
    solver = keys(spec["solver"], {"time_limit_seconds", "random_seed"}, set(), "solver")
    limit = solver["time_limit_seconds"]
    if type(limit) not in (int, float) or not math.isfinite(limit) or limit <= 0:
        raise ValueError("time_limit_seconds must be finite and positive")
    if integer(solver["random_seed"], "random_seed") > 2147483647:
        raise ValueError("random_seed must be <= 2147483647")


def records(path: Path, mapping: dict):
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        headers = reader.fieldnames or []
        if len(headers) != len(set(headers)) or not set(mapping.values()) <= set(headers):
            raise ValueError(f"{path}: duplicate or missing CSV columns")
        for line, record in enumerate(reader, 2):
            if None in record or any(value is None for value in record.values()):
                raise ValueError(f"{path}:{line}: malformed CSV row")
            mapped = {key: record[column].strip() for key, column in mapping.items()}
            if any(not value for value in mapped.values()):
                raise ValueError(f"{path}:{line}: empty required value")
            yield mapped


def csv_int(value: str, field: str) -> int:
    if not value.isascii() or not value.isdecimal():
        raise ValueError(f"{field}: expected a nonnegative integer, got {value!r}")
    return int(value)


def load_samples(spec: dict, base: Path) -> tuple[list[Sample], list[dict]]:
    validate_spec(spec)
    inputs, array = spec["inputs"], spec["array"]
    paths = [(base / inputs["roster"]).resolve(),
             *((base / path).resolve() for path in inputs["fails"])]
    if len(set(paths)) != len(paths):
        raise ValueError("The same input file was selected more than once")
    before = [fingerprint(path) for path in paths]
    fails: dict[tuple[str, str], set] = {}
    counts = {}
    for record in records(paths[0], inputs["roster_columns"]):
        key = (record["group"], record["sample_id"])
        if key in fails:
            raise ValueError(f"Duplicate sample in roster: {key}")
        fails[key] = set()
        if "fail_count" in record:
            counts[key] = csv_int(record["fail_count"], "fail_count")
    if not fails:
        raise ValueError("Roster is empty; yield denominator is undefined")
    for path in paths[1:]:
        for record in records(path, inputs["fail_columns"]):
            key = (record["group"], record["sample_id"])
            if key not in fails:
                raise ValueError(f"{path}: sample {key} is absent from roster")
            row = csv_int(record["row"], "row") - array["coordinate_base"]
            col = csv_int(record["col"], "col") - array["coordinate_base"]
            if not (0 <= row < array["rows"] and 0 <= col < array["cols"]):
                raise ValueError(f"{path}: out-of-bounds coordinate for {key}: {(row, col)}")
            if (row, col) in fails[key]:
                raise ValueError(f"{path}: duplicate coordinate for {key}: {(row, col)}")
            fails[key].add((row, col))
    for key, expected in counts.items():
        if expected != len(fails[key]):
            raise ValueError(f"Roster fail_count mismatch for {key}: {expected} != {len(fails[key])}")
    if before != [fingerprint(path) for path in paths]:
        raise ValueError("Inputs changed while being read; prepare the plan again")
    return [Sample(group, sid, array["rows"], array["cols"], frozenset(coords))
            for (group, sid), coords in sorted(fails.items())], before
