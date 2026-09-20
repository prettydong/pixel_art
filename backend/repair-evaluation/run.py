"""Prepare a reviewable plan, then execute precisely that plan after confirmation."""
from __future__ import annotations

import argparse
from collections import Counter
import csv
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import platform
import shutil
import sys

from data import fingerprint, load_samples, read_json
from framework import FRAMEWORK_VERSION, evaluate, summarize

ROOT = Path(__file__).resolve().parent


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
                    encoding="utf-8")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_device(path: Path):
    spec = importlib.util.spec_from_file_location("experiment_device", path)
    if spec is None or spec.loader is None:
        raise ValueError("Cannot load device module")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    # Compile source directly so a same-size edit within one second cannot load
    # an old timestamp-based .pyc while the manifest records the new source hash.
    exec(compile(path.read_bytes(), str(path), "exec"), module.__dict__)
    if getattr(module, "DEVICE_API_VERSION", None) != 1:
        raise ValueError("Device must implement DEVICE_API_VERSION = 1")
    for name in ("validate_config", "describe", "build_model"):
        if not callable(getattr(module, name, None)):
            raise ValueError(f"Device is missing {name}")
    return module


def prepare(config_path: Path, device_path: Path):
    config_path, device_path = config_path.resolve(), device_path.resolve()
    sources = [ROOT / name for name in ("run.py", "models.py", "data.py", "framework.py", "requirements.txt")]
    sources.append(device_path)
    source_hashes = [fingerprint(path) for path in sources]
    config_hash = fingerprint(config_path)
    spec = read_json(config_path)
    samples, inputs = load_samples(spec, config_path.parent)
    device = load_device(device_path)
    device.validate_config(spec["device"])
    description = device.describe(spec["device"])
    if not isinstance(description, dict):
        raise ValueError("Device describe() must return a JSON object")
    if config_hash != fingerprint(config_path) or source_hashes != [fingerprint(p) for p in sources]:
        raise ValueError("Config or code changed during planning; prepare again")
    plan = {
        "schema_version": 1, "framework_version": FRAMEWORK_VERSION,
        "config_file": config_hash, "device_file": str(device_path),
        "config": spec, "sources": source_hashes, "inputs": inputs,
        "device_description": description,
        "dataset": {"samples": len(samples), "initially_good": sum(not s.fails for s in samples),
                    "distinct_fails_per_sample_total": sum(len(s.fails) for s in samples),
                    "groups": dict(sorted(Counter(s.group for s in samples).items()))},
    }
    encoded = json.dumps(plan, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()
    plan["plan_id"] = hashlib.sha256(encoded).hexdigest()
    return plan, samples, device


def print_plan(plan: dict) -> None:
    print(json.dumps({key: plan[key] for key in
                      ("plan_id", "config", "inputs", "dataset", "device_description")},
                     ensure_ascii=False, indent=2))


def execute(plan_path: Path, output: Path) -> None:
    approved = read_json(plan_path)
    current, samples, device = prepare(Path(approved["config_file"]["path"]),
                                        Path(approved["device_file"]))
    if approved != current:
        raise ValueError("Plan no longer matches input/config/device/framework. Prepare and confirm a new plan")
    try:
        import highspy
        import numpy as np
    except ImportError as error:
        raise RuntimeError("Install requirements.txt into the experiment Python environment first") from error
    # Refuse to overwrite an earlier experiment, even if the earlier run failed.
    output.mkdir(parents=True, exist_ok=False)
    run = {"status": "running", "started_at": utc_now(), "plan_id": current["plan_id"],
           "python_version": platform.python_version(), "highs_version": highspy.Highs().version(),
           "numpy_version": np.__version__, "command": sys.argv, "completed_samples": 0}
    write_json(output / "run.json", run)
    results = []
    try:
        write_json(output / "plan.json", current)
        snapshots = output / "sources"
        snapshots.mkdir()
        for index, source in enumerate([current["config_file"], *current["sources"]]):
            target = snapshots / f"{index:02d}_{Path(source['path']).name}"
            shutil.copyfile(source["path"], target)
            if fingerprint(target)["sha256"] != source["sha256"]:
                raise ValueError("Source changed while saving experiment snapshot")
        with (output / "results.jsonl").open("w", encoding="utf-8") as stream:
            for index, sample in enumerate(samples, 1):
                model = device.build_model(sample, current["config"]["device"])
                result = evaluate(sample, model, current["config"]["solver"])
                results.append(result)
                stream.write(json.dumps(result, ensure_ascii=False, allow_nan=False) + "\n")
                stream.flush()
                run["completed_samples"] = index
                print(f"[{index}/{len(samples)}] {sample.group}/{sample.sample_id}: {result['status']}", flush=True)
        # Do not label results reproducible if an input or implementation changed
        # during execution. Partial witnesses remain available for diagnosis.
        for source in [current["config_file"], *current["sources"], *current["inputs"]]:
            if fingerprint(Path(source["path"])) != source:
                raise ValueError("Input/config/source changed during the experiment")
        fields = ["group", "sample_id", "fail_count", "status", "solver_status",
                  "witness_verified", "minimum_action_count_proven", "elapsed_seconds"]
        with (output / "samples.csv").open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(results)
        summary = {"plan_id": current["plan_id"], "data_kind": current["config"]["data_kind"],
                   "evaluation_unit": current["config"]["evaluation_unit"],
                   "overall": summarize(results),
                   "by_group": {group: summarize([r for r in results if r["group"] == group])
                                for group in sorted({s.group for s in samples})}}
        write_json(output / "summary.json", summary)
        write_report(output / "report.md", summary, current)
        run.update(status="completed", finished_at=utc_now())
        write_json(output / "run.json", run)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    except BaseException as error:
        run.update(status="failed", finished_at=utc_now(), error=str(error))
        write_json(output / "run.json", run)
        raise


def write_report(path: Path, summary: dict, plan: dict) -> None:
    def percentage(value):
        return "未完全判定" if value is None else f"{value:.4%}"
    lines = ["# 修补评估", "", f"计划：`{plan['plan_id']}`", "",
             f"数据类型：{summary['data_kind']}；评估单位：{summary['evaluation_unit']}。",
             "每个名册条目独立使用一套冗余资源。采样或模拟结果不等于真实量产器件良率。", "",
             "| 分组 | 样本数 | 原始通过 | 可通过（含零失效） | 不可修复 | 未判定 | 修补后良率 | 良率范围 |",
             "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |"]
    for group, stats in [("总体", summary["overall"]), *summary["by_group"].items()]:
        # Group labels come from CSV data, not Markdown instructions.
        label = group.replace("|", "\\|").replace("\n", " ").replace("\r", " ")
        lines.append(f"| {label} | {stats['total']} | {stats['initially_good']} | {stats['repairable']} | "
                     f"{stats['unrepairable']} | {stats['unknown']} | {percentage(stats['repair_yield'])} | "
                     f"{percentage(stats['repair_yield_lower_bound'])}–{percentage(stats['repair_yield_upper_bound'])} |")
    lines += ["", "分母为完整名册中的样本数，总体按样本加权。未判定不记为不可修复；范围不是统计置信区间。",
              "可修复结果已复核覆盖、资源用量及附加线性约束；规则是否符合器件仍取决于 device 的建模。",
              "", "规则快照：", "", "```json", json.dumps(plan["device_description"], ensure_ascii=False, indent=2),
              "```", "", "逐样本方案见 results.jsonl；数据与代码指纹见 plan.json；源代码快照见 sources/。"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    plan_cmd = commands.add_parser("plan", help="Validate data and describe the proposed experiment; no solve")
    plan_cmd.add_argument("--config", type=Path, required=True)
    plan_cmd.add_argument("--device", type=Path, default=ROOT / "device.py")
    plan_cmd.add_argument("--out", type=Path, required=True)
    run_cmd = commands.add_parser("run", help="Execute a previously confirmed plan")
    run_cmd.add_argument("--plan", type=Path, required=True)
    run_cmd.add_argument("--out", type=Path, required=True, help="New output directory; must not already exist")
    args = parser.parse_args()
    if args.command == "plan":
        plan, _, _ = prepare(args.config, args.device)
        # Exclusive creation protects both raw inputs and existing reviewed plans.
        with args.out.open("x", encoding="utf-8") as stream:
            json.dump(plan, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
        print_plan(plan)
    else:
        execute(args.plan, args.out)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, RuntimeError, ImportError) as error:
        print(f"Evaluation failed: {error}", file=sys.stderr)
        sys.exit(1)
