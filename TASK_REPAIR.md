# Batch C++ Repair Tasks

Task navigation includes "Task solving". First save definitions under "Architecture", register and link wafers under "Data", then select multiple architectures, wafers, and a coding engine. Review the combinations and click "Add and run". Currently, one dataset corresponds to one registered `.pwafer`; for example, 2 architectures and 3 wafers produce 6 jobs. A batch is limited to 100 jobs; each user may have at most 200 unfinished jobs.

The service requires a working Pi model configuration and `g++` with C++17 support. Deploy using the existing root-level `npm run build` and startup flow, retaining `backend/repair-cpp/` and `scripts/repair-supervisor.mjs`. The solver is compiled per job after running is requested. Source integration is complete; this development did not run builds, compilation, real model calls, or browser acceptance checks.

## Execution Flow

1. Submission freezes architecture names, definitions, fingerprints, wafer metadata, and file SHA-256 hashes. Batch addition is transactional; the same request identifier does not enqueue duplicate jobs.
2. The backend creates an independent coding chat with the selected engine, providing an architecture snapshot and the C++ contract. The agent implements only `dev.hpp`, validating architecture parameters and generating resource pools and repair candidates, without compiling or solving. Jobs with the same architecture in a batch reuse one generated result.
3. The backend copies trusted `main.cpp`, `model.hpp`, and `repair_most.hpp`, adds the generated `dev.hpp` and input snapshot, and invokes `g++` with fixed compilation arguments. Compilation failures appear in the job, and logs are downloadable.
4. C++ runs repairMost independently for each nonempty region. At each step, it selects a budget-feasible action covering the most uncovered fails; ties are ordered by action ID. It then recomputes coverage and resource usage to verify the generated plan.
5. The backend checks the C++ exit code, JSONL progress, complete data denominators, original passing-unit counts, yield formulas, disk results against the stdout summary, and input/code fingerprints. Only after all checks pass does it publish completion and yield.

There is currently one background solving queue, with limits on concurrent coding, compilation, and solving. Jobs can be canceled individually. Service restarts mark unfinished jobs as "Interrupted" without automatically rerunning them or repeating model calls. Disabling or resetting an account stops its jobs. Canceling a job during coding requires recoding for the remaining jobs with that architecture; completed code can be reused.

## dev.hpp and Architecture Constraints

See the [C++ README](backend/repair-cpp/README.md) and [dev.hpp](backend/repair-cpp/dev.hpp) for templates and function contracts. The repository's `dev.hpp` is a placeholder that explicitly errors; it cannot be used to compute with default parameters. For each batch, the agent writes its coding conversation's `work/repair-codegen/dev.hpp`; the backend then freezes it into the solving directory without overwriting the repository template.

The agent must implement `dev::validate_layout(rows, cols)` and `dev::build_model(region)`. All input coordinates are zero-based. The generic model expresses nonnegative action consumption from one or more resource pools and capacity limits. Rules that cannot be expressed must cause an error. The core checks model indices, duplicates, coverage, and budgets; it does not automatically prove that the agent's mapping matches the physical device. Generated code and rules must be checked against the architecture.

CCR follows the [confirmed architecture definitions](MEMORY_REDUNDANCY_DEFINITIONS.md): each region shares one global row pool; column pools are independent by `(segment, col % groups)`. Column capacity cannot be borrowed across regions, segments, or subgroups. Segments must use the section/subsection formula rather than equal row partitions. All resource quantities come from the submitted architecture snapshot.

## Yield Definitions and Artifacts

- Region yield = (original zero-fail regions + regions with a complete repair plan found) / complete region count.
- Wafer chip yield = chips whose regions all pass / the wafer's complete chip count.
- `heuristic_unresolved` means repairMost did not find a repair, not that infeasibility was proved. These ratios are pass rates for plans found by this heuristic. Synthetic wafers remain labeled as synthetic and do not represent real production yield.
- Omitted sparse regions represent zero fails and remain in the complete denominator. Per-region JSONL lists only nonempty regions and ends with a complete summary.

Each execution snapshot is saved under `PIXEL_DATA_DIR/users/<userId>/repair-jobs/<jobId>/`, including the wafer, normalized integer input, core source code, `dev.hpp`, compilation files, logs, and results. The interface offers downloads for `dev.hpp`, `manifest.json`, `compile.log`, and `result.jsonl`; early failures or cancellations may leave some files ungenerated. The task panel retains architecture fingerprints and timestamps, so old results remain associated with their old snapshots after an architecture changes.

Compilation is limited to 60 seconds and solving to 10 minutes. Logs, output, and model size are bounded. On Linux, CPU, address-space, and file-size limits are applied when `prlimit` is installed. The process supervisor monitors service IPC and cleans up the execution group when the service exits. These controls retain the project's trusted-team deployment boundary; see [execution boundaries](backend/repair-cpp/EXECUTION.md).

## Suggested Manual Acceptance Checks

Start with 2 size-compatible architectures × 2 small wafers. Confirm that 4 jobs are queued and jobs with the same architecture use one coding chat. Then check all-zero wafers, zero-capacity inputs with fails, exact resource exhaustion, the same CCR column in different segments, size mismatches, and states after service interruption. All-zero inputs must still pass architecture validation; errors and interruptions must not publish yield. Check downloaded code, rules, and per-region plans before using large wafers.
