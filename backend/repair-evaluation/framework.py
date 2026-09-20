"""Fixed binary-cover evaluation, using HiGHS and independently checked witnesses."""
from __future__ import annotations

from collections import Counter
import math
import time

from models import RepairModel, Sample, integer

FRAMEWORK_VERSION = "1.0.0"


def validate_model(sample: Sample, model: RepairModel) -> None:
    if not isinstance(model, RepairModel):
        raise ValueError("device.build_model must return RepairModel")
    for pool, capacity in model.capacities.items():
        if not isinstance(pool, str) or not pool:
            raise ValueError("Resource pool names must be nonempty strings")
        integer(capacity, f"capacity {pool}")
    ids = set()
    for action in model.actions:
        if not isinstance(action.id, str) or not action.id or action.id in ids:
            raise ValueError(f"Empty or duplicate action id: {action.id}")
        ids.add(action.id)
        if not isinstance(action.covers, frozenset) or not action.covers <= sample.fails:
            raise ValueError(f"{action.id}: covers must be a frozenset of sample fail coordinates")
        for pool, amount in action.uses.items():
            if pool not in model.capacities:
                raise ValueError(f"{action.id}: unknown pool {pool}")
            integer(amount, f"{action.id}.uses[{pool}]", 1)
    rule_ids = set()
    for rule in model.rules:
        if not isinstance(rule.id, str) or not rule.id or rule.id in rule_ids:
            raise ValueError(f"Empty or duplicate rule id: {rule.id}")
        rule_ids.add(rule.id)
        if rule.lower is None and rule.upper is None:
            raise ValueError(f"{rule.id}: rule has no bound")
        for bound in (rule.lower, rule.upper):
            if bound is not None and type(bound) is not int:
                raise ValueError(f"{rule.id}: bounds must be integers or None")
        if rule.lower is not None and rule.upper is not None and rule.lower > rule.upper:
            raise ValueError(f"{rule.id}: lower > upper")
        for action, value in rule.coefficients.items():
            if action not in ids or type(value) is not int:
                raise ValueError(f"{rule.id}: unknown action or noninteger coefficient")


def check_witness(sample: Sample, model: RepairModel, selected: set[str]) -> dict:
    actions = {action.id: action for action in model.actions}
    if not selected <= actions.keys():
        raise ValueError("Unknown action in solver witness")
    used = {pool: 0 for pool in model.capacities}
    covered = set()
    for name in selected:
        action = actions[name]
        covered.update(action.covers)
        for pool, count in action.uses.items():
            used[pool] += count
    violated = []
    for rule in model.rules:
        value = sum(coef for action, coef in rule.coefficients.items() if action in selected)
        if ((rule.lower is not None and value < rule.lower)
                or (rule.upper is not None and value > rule.upper)):
            violated.append(rule.id)
    remaining = len(sample.fails - covered)
    valid = not remaining and not violated and all(
        used[pool] <= capacity for pool, capacity in model.capacities.items())
    return {"valid": valid, "resource_usage": used, "uncovered_count": remaining,
            "violated_rules": violated}


def evaluate(sample: Sample, model: RepairModel, options: dict) -> dict:
    validate_model(sample, model)
    start = time.monotonic()
    result = {"group": sample.group, "sample_id": sample.sample_id,
              "fail_count": len(sample.fails), "status": "unknown", "selected_actions": [],
              "resource_capacities": model.capacities, "resource_usage": None,
              "minimum_action_count_proven": False, "witness_verified": False}
    # A constant model can be decided exactly without asking a solver to handle
    # an empty matrix (HiGHS reports ModelEmpty for a zero-variable model).
    if not model.actions:
        checked = check_witness(sample, model, set())
        return {**result, "status": "repairable" if checked["valid"] else "unrepairable",
                **checked, "witness_verified": checked["valid"],
                "solver_status": "constant_model", "minimum_action_count_proven": checked["valid"],
                "elapsed_seconds": time.monotonic() - start}

    import highspy
    import numpy as np

    solver = highspy.Highs()

    def ok(status):
        if status != highspy.HighsStatus.kOk:
            raise RuntimeError(f"HiGHS model/options error: {status}")

    for name, value in {"output_flag": False, "threads": 1,
                        "time_limit": float(options["time_limit_seconds"]),
                        "random_seed": options["random_seed"], "mip_rel_gap": 0.0}.items():
        ok(solver.setOptionValue(name, value))
    by_id = {}
    covering = {cell: [] for cell in sample.fails}
    pools: dict[str, list[tuple[int, int]]] = {pool: [] for pool in model.capacities}
    for i, action in enumerate(model.actions):
        # Minimize action count only to obtain a compact witness; yield needs
        # feasibility, not proof that the repair uses the fewest spares.
        ok(solver.addCol(1.0, 0.0, 1.0, 0,
                         np.array([], dtype=np.int32), np.array([], dtype=np.float64)))
        ok(solver.changeColIntegrality(i, highspy.HighsVarType.kInteger))
        by_id[action.id] = i
        for cell in action.covers:
            covering[cell].append(i)
        for pool, count in action.uses.items():
            pools[pool].append((i, count))

    def constraint(lower, upper, terms):
        ok(solver.addRow(lower, upper, len(terms),
                         np.array([i for i, _ in terms], dtype=np.int32),
                         np.array([v for _, v in terms], dtype=np.float64)))

    inf = highspy.kHighsInf
    for cell in sorted(covering):
        constraint(1.0, inf, [(i, 1) for i in covering[cell]])
    for pool, capacity in model.capacities.items():
        constraint(-inf, float(capacity), pools[pool])
    for rule in model.rules:
        constraint(-inf if rule.lower is None else float(rule.lower),
                   inf if rule.upper is None else float(rule.upper),
                   [(by_id[name], coef) for name, coef in rule.coefficients.items()])
    run_status = solver.run()
    if run_status == highspy.HighsStatus.kError:
        raise RuntimeError("HiGHS failed while solving")
    status = solver.getModelStatus()
    result["solver_status"] = solver.modelStatusToString(status)
    result["elapsed_seconds"] = time.monotonic() - start
    if status == highspy.HighsModelStatus.kInfeasible:
        return {**result, "status": "unrepairable"}
    solution = solver.getSolution()
    if solution.value_valid:
        values = list(solution.col_value)
        integral = len(values) == len(model.actions) and all(
            math.isfinite(v) and min(abs(v), abs(v - 1)) <= 1e-6 for v in values)
        if integral:
            selected = {a.id for a, v in zip(model.actions, values) if v > 0.5}
            checked = check_witness(sample, model, selected)
            if checked["valid"]:
                return {**result, **checked, "status": "repairable",
                        "selected_actions": sorted(selected), "witness_verified": True,
                        "minimum_action_count_proven": status == highspy.HighsModelStatus.kOptimal}
    if status == highspy.HighsModelStatus.kOptimal:
        raise RuntimeError("HiGHS reported optimal but its repair witness failed validation")
    return {**result, "reason": "No verified repair witness and no infeasibility proof"}


def summarize(results: list[dict]) -> dict:
    total = len(results)
    if not total:
        raise ValueError("Cannot summarize zero samples")
    counts = Counter(item["status"] for item in results)
    passing = counts["repairable"]
    unknown = counts["unknown"]
    defective = sum(item["fail_count"] > 0 for item in results)
    rescued = sum(item["fail_count"] > 0 and item["status"] == "repairable" for item in results)
    return {
        "total": total, "initially_good": total - defective,
        "repairable": passing, "unrepairable": counts["unrepairable"], "unknown": unknown,
        "baseline_yield": (total - defective) / total,
        "repair_yield": passing / total if not unknown else None,
        "repair_yield_lower_bound": passing / total,
        "repair_yield_upper_bound": (passing + unknown) / total,
        "rescued_defective": rescued, "defective_total": defective,
        "defective_repair_rate": rescued / defective if defective and not unknown else None,
    }
