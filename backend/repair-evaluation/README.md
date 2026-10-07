# HiGHS Repair Evaluation Framework

The framework handles input validation, per-sample solving, plan verification, and yield summaries. The agent interprets inputs and device structure and modifies `device.py`. The solver does not hard-code a particular redundancy structure. Current integration uses a CLI and Pi skill without a dedicated frontend page.

Each chat conversation receives an independent code copy under `work/repair-evaluation/`. Existing files are not overwritten, so user modifications persist across runs. `PIXEL_REPAIR_DIR` points to that copy. Do not modify repository templates for a user's one-off experiment. Future framework upgrades require explicit migration of existing copies; filling missing files is not a complete version upgrade.

## File Responsibilities

| File | Responsibility |
| --- | --- |
| `models.py` | Contracts for `Sample`, `Action`, `LinearRule`, and `RepairModel` |
| `data.py` | Validation of CSV, complete rosters, bounds, duplicates, expected counts, and file fingerprints |
| `framework.py` | HiGHS binary covering model, repair-plan verification, and yield definitions |
| `device.py` | Editable device structure, parameter validation, rule descriptions, and repair candidates |
| `run.py` | Two-stage `plan` / `run` execution, snapshots, and result output |
| `experiment.example.json` | Example configuration; its values are not user defaults |

## CCR Device: Region-Global Rows and Segment-Local Columns

In this model, one framework `sample` is one **region** (a bank in the original smart-eval). `spare_rows` is the region's global spare-row capacity, defaulting to 128, with pool key `region_rows`. All segments share this pool. One action covers all fails on one original row within the region and consumes 1 spare row. Different regions do not share this pool. Therefore `repair_yield` is region-level. Chip yield must be aggregated externally only after confirming that all regions belonging to each chip are repairable; region yield must not be called chip yield.

CCR column resources repeat independently per segment. `ccr_groups_per_segment` is the group count in each segment, and `ccr_spares_per_group[g]` is that segment's capacity for group g. For a fail `(row, col)`, derive its segment using the retained smart-eval section/subsection mapping:

```python
section_group = row // section_group_size
subsection = (row % section_group_size) // subsection_size \
             + section_group * subsections_per_group
segment = subsection // sections_per_segment
group = col % ccr_groups_per_segment
```

A CCR action corresponds to `(segment, original_col)`, covering all fails at that **original column address** within the segment and consuming 1 unit from `segment_{segment}_ccr_{group}`. Column addresses are neither folded nor offset; capacity cannot be borrowed across groups or segments. Each region has one global row pool. Column pools are created only for `(segment, group)` pairs with fails; candidates include only original rows/columns with fails, so empty regions are valid without enumerating a complete matrix. The model does not support LCR, ECC, or resources shared across regions.

`row_layout` requires `section_count` to be divisible by both `subsections_per_group` and `sections_per_segment`, and `section_group_size <= subsection_size * subsections_per_group`. Derived row count:

```python
expected_rows = (section_count // subsections_per_group) * section_group_size
segment_count = section_count // sections_per_segment
```

`experiment.example.json` uses DEJOA dimensions of `32768 × 2048` and the user-confirmed default of 128 global spare rows per region. The 2 CCR spare columns per group remain an example, not a confirmed production column-resource configuration. It has 96 sections with 2 sections per segment, giving 48 segments; `2048 <= 344 * 6` is valid. Experiment files still use framework `schema_version: 1`; frontend pixel-architecture JSON with `version: 2, model: "region-ccr"` is a separate configuration contract and cannot replace this experiment input.

## Data Contract

Python >=3.10. Core input is UTF-8 CSV, optionally with a BOM. Paths resolve relative to the experiment JSON directory, or may be absolute. Configuration maps column names; extra columns are ignored, and mapped fields must not be missing.

- The roster must contain `group,sample_id`. Optional `fail_count`: if mapped, every row must contain a nonnegative integer exactly matching the original coordinate count. If no count column exists, remove the mapping from `roster_columns` rather than inventing values.
- Fail tables must contain `group,sample_id,row,col`. Multiple files may be selected and validated jointly as one input set. `group` is a data-group label, **not** a spare-column resource-group index.
- Roster keys `(group,sample_id)` must be unique and include zero-fail samples. Sample IDs are strings; `01` and `1` are not merged automatically.
- Fails must belong to roster samples. Coordinates for the same sample must not duplicate across files. Duplicate coordinates, out-of-bounds values, blanks, nonintegers, and count mismatches cause errors rather than silent deduplication, discarding, or rewriting.
- All samples in current standard input share one array size. The CCR device requires rows equal to row layout's derived `expected_rows` and a positive integer column count. Each roster record receives independent region-global row and segment-local CCR column pools. `evaluation_unit` remains `sample`, meaning region; the framework does not automatically merge regions belonging to the same chip.
- A roster sample with no fail-table records is treated as zero-fail under sparse-data conventions. The framework cannot detect omitted upload files. Check selected files and expected counts during planning; absent fail records alone do not prove original-data completeness.

The chosen data, `data_kind` (`measured`/`synthetic`), evaluation unit, array dimensions, resource quantities, and rules must come from current user instructions or confirmed information. `experiment.example.json` illustrates format only; its paths are intentionally not directly runnable, and it contains no synthetic data or precomputed yield.

## Prepare a Plan and Execute

Work in the current conversation's `$PIXEL_REPAIR_DIR`; for standalone use, copy the entire directory. Copy `experiment.example.json` to `experiment.json`, fill it for the actual task, and verify the selected CCR device and device configuration. The service supplies missing `ccr-device-v3.py` to conversations. When copying the repository framework for standalone use, change `--device` below to `device.py`. The following planning step reads original data only, does not invoke HiGHS, and needs no dependency installation:

```bash
cd "$PIXEL_REPAIR_DIR"
python3 run.py plan --config experiment.json --device ccr-device-v3.py --out plan-001.json
```

Output includes data paths, SHA-256, sample count, initial passing-sample count, resource configuration, and rule descriptions. The agent must compare these with user-confirmed conditions; ask first if critical conditions are missing. A plan is a reviewable snapshot, not proof of authorization. The framework checks file consistency; the conversation workflow handles user confirmation.

Generate a new plan whenever configuration, device, framework, or data changes. Do not execute new rules using an old plan. Already explicitly authorized conditions do not require repeated confirmation. Prepare the Python environment for first execution:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python run.py run --plan plan-001.json \
  --out "$PIXEL_WORK_DIR/artifacts/repair-001"
```

`--device` selects the current rules' `ccr-device-v3.py` in the conversation directory. The plan records its fingerprint; `run` snapshots that same file and rejects changes made after planning. `plan` and `run` may use different Python environments, but code and data must remain unchanged. `--out` must name a new nonexistent directory; old experiments cannot be overwritten. Each sample has its own solve timeout, while the whole batch remains subject to the service's `PIXEL_RUN_TIMEOUT_SECONDS`. Plan task size before processing many samples; timeout does not automatically produce a complete experiment conclusion.

`run` uses the [official HiGHS Python interface](https://ergo-code.github.io/HiGHS/stable/interfaces/python/), pinned to `highspy==1.13.1`. Actual HiGHS and Python versions are recorded. No global Python installation is modified.

## Device Modification Interface

A device is trusted Python code, not a sandbox. Keep it in one file. Apart from the standard library and `models`, do not depend on unrecorded local helper code; if splitting is necessary, first extend the runner's source-snapshot inventory. Do not execute experiments, read/write inputs, or generate random data during import or in `describe()`.

```python
DEVICE_API_VERSION = 1

def validate_config(config: dict) -> None:
    # Validate current structural parameters; reject unknown or missing fields.
    ...

def describe(config: dict) -> dict:
    # Return JSON rule descriptions consistent with the implementation for user confirmation.
    ...

def build_model(sample: Sample, config: dict) -> RepairModel:
    # Generate all legal repair candidates and constraints; do not call the solver or modify sample.fails.
    ...
```

`Action(id, covers, uses)` represents a binary decision. `covers` is the current sample's fail set covered by the action (`frozenset`); `uses` specifies resource-pool consumption, e.g. `{"region_rows": 1}`. `RepairModel.capacities` defines pool limits; one action may consume multiple pools.

`LinearRule` expresses additional constraints, such as choosing at most one of two configurations of the same physical resource:

```python
LinearRule("exclusive", {"option_a": 1, "option_b": 1}, upper=1)
```

The current CCR device's row actions share the region-global pool; column actions consume resources local to their segment and subgroup. The framework solves each region sample independently. Rows are not shared across regions; columns cannot borrow across regions, segments, or subgroups. ECC, cross-region coupling, and nonlinear constraints are outside the current model.

The solver creates a binary variable `x[a]` for each candidate:

- For each fail: the sum of all `x[a]` covering it is ≥ 1.
- For each resource pool: the sum of action consumption multiplied by `x[a]` is ≤ available capacity.
- For each additional rule: the linear sum lies within the declared lower/upper bounds.

The objective minimizes action count for a concise plan; repairability requires only a complete legal plan. After receiving a plan, the framework recomputes coverage, resource usage, and additional rules using integers. This verification detects plans violating the declared model; it cannot prove that agent-described rules match the real device or detect legal candidates omitted from the model.

## States, Yield, and Artifacts

| State | Determination |
| --- | --- |
| `repairable` | A complete integer repair plan passes independent verification, or a constant model without variables satisfies all conditions |
| `unrepairable` | HiGHS proves infeasibility, or a constant model without variables is explicitly infeasible |
| `unknown` | For example, timeout without a valid complete plan or an infeasibility proof |

Numerical/solver errors fail the run; errors are not labeled unrepairable merely to fill the denominator. A legal plan found before timeout still establishes repairability, without claiming the minimum action count. Zero-fail samples remain in the roster denominator; the example device can pass them directly.

`repair_yield = repairable / total`, with repairable including original zero-fail samples. With unknown samples, the point estimate is `null` and bounds are `[repairable / total, (repairable + unknown) / total]`. These bounds reflect solve states, not a statistical confidence interval. `defective_repair_rate` instead uses initially defective samples as its denominator. Overall yield weights all samples rather than averaging group percentages.

- `run.json`: run state, completed count, timestamps, and Python/HiGHS versions. Only `completed` indicates complete results; a forcibly terminated process may still leave `running`, which must not be treated as completion.
- `plan.json`: executed conditions, source-file paths, and fingerprints.
- `sources/`: configuration and framework/device source snapshots. Original user data is not copied and must be retained separately.
- `results.jsonl`: per-sample states, selected action IDs, resource usage, and solver states; partial records may remain after a failure.
- `samples.csv`: per-sample table for aggregation.
- `summary.json` and `report.md`: overall/group yield and rule descriptions.

## Suggested Manual Checks

Users may manually check: zero-fail regions; defective regions with zero redundancy; multiple fails on one row consuming only 1 global spare row; with the default 128 rows and zero CCR column capacity, 128 distinct rows across any segments being repairable and 129 unrepairable; columns 0/8 in one segment competing for the same modulo-8 CCR group capacity; the same original column consuming separate capacities in different segments; spare CCR columns in other groups/segments not being borrowable; combined row/column repair; rejection when row count differs from the layout-derived value; rejection of duplicate coordinates, missing samples, and mismatched counts; rejection of old plans after device changes; unresolved timeouts included in bounds; and groups with different sample counts weighted by region.
