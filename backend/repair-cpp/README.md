# repair-solver

`repair-solver INPUT.txt RESULTS.jsonl` is a C++17 per-region heuristic solver.
It reads the Node codec's integer-only `PIXEL_REPAIR_INPUT_V1` stream:

```text
PIXEL_REPAIR_INPUT_V1 chips regions rows cols failCount groupCount
```

It then reads exactly `groupCount` nonempty-region lines:

```text
regionIndex count position...
```

`regionIndex` is a global layout index and is strictly increasing; it need not
be contiguous because omitted regions are initially good. Every input group
must have a positive count. Positions must be strictly increasing `row * cols
+ col` values. Header counts must match the data and non-whitespace trailing
input is rejected. `groupCount` may be zero. The input limits are at most
1,000,000 complete layout regions, 100,000 nonempty groups, and 5,000,000
fails in the wafer (and therefore in one region). `rows * cols` may be any
positive value through `UINT32_MAX`; sparse data is not rejected merely because
the physical region has more than 16 million cells.

Only nonempty regions receive a `type: "region"` JSONL record. A final
`type: "summary"` record is always written. Standard output contains only
throttled progress JSON and the summary. A progress line is flushed each 128
nonempty groups with `processedRegions` as the one-past global layout index of
that group and `totalRegions` as the complete layout count; the final progress
line always has `processedRegions == totalRegions`, including a zero-fail
wafer. Errors are short stderr messages with a nonzero exit code.

## Agent extension contract

An architecture agent edits **only** [`dev.hpp`](dev.hpp):

```cpp
namespace dev {
  void validate_layout(uint32_t rows, uint32_t cols);
  repair::Model build_model(const repair::Region& region);
}
```

`validate_layout` runs once after decoding the layout, including a zero-fail
wafer, and must throw for unsupported shapes. `build_model` runs per nonempty
region. `Region::fails` holds local fail coordinates; each `Action::covers`
entry is an index into that vector, never a row/column/global position.

The supplied `dev.hpp` deliberately throws. There is no default architecture
or hidden redundancy-resource policy.

```cpp
repair::Model model{
  { {"row-spares", 2}, {"col-spares", 1} },
  {
    {"replace-row-7", {0, 3}, {{0, 1}}},
    {"replace-column-2", {1, 2}, {{1, 1}}},
  },
};
```

A `Pool` has a unique string ID of at most 256 bytes and nonnegative capacity.
An `Action` has a unique string ID of at most 256 bytes, sorted unique covered fail indexes, and one or more sorted
unique pool-cost pairs. Costs must be positive. Total cost in every pool is
bounded by its capacity. Mutual exclusion uses a shared capacity-one pool: put
a cost of one for every incompatible action in a named pool such as `mux-17`.

The core rejects out-of-bounds or duplicate `Region::fails` coordinates,
duplicate IDs, invalid or duplicate coverage/resource indexes, empty action
coverage/resources, excessive model sizes, and integer overflow.
The only supported rule is an additive upper bound on a pool. Conditional
choices, implications, arbitrary Boolean rules, and non-equivalent action-count
rules are unsupported. An agent must add a clear description to
`Model::unsupported_constraints` for every unrepresentable rule; the solver
then fails explicitly rather than silently weakening the architecture.

## CCR mapping example

CCR is an implementation in `dev.hpp`, never a default parameter set. For a
region, create one shared row pool with capacity `spare_rows` (the confirmed
default is 128). For each original row containing local fails, add one row
action covering all local fail indexes on that row and consuming one unit of
this single region-wide pool. That pool is shared by every segment and never
crosses a region boundary.

Derive a fail's segment from its zero-based row using the configured layout:

```text
section_group = row / section_group_size
subsection = (row % section_group_size) / subsection_size
             + section_group * subsections_per_group
segment = subsection / sections_per_segment
```

For each `(segment, original_col)` with local fails, add one column action
covering those indexes. Its pool is `(segment, original_col %
ccr_groups_per_segment)` and its capacity is
`ccr_spares_per_group[original_col % ccr_groups_per_segment]`. Every segment
owns its own copy of every CCR-group pool: columns in different segments never
share column redundancy, including the same original column. A row or local
column action consumes exactly one unit regardless of how many fails it
covers. CCR therefore needs no invented row/column mutual-exclusion pool.

## Heuristic and yield meaning

`repairMost` uses an inverted fail-to-action index and lazy max heap. Each step
selects a currently budget-feasible action covering the most uncovered fails;
ties use ascending action ID. It independently rechecks coverage and budgets.
`heuristic_unresolved` only means this heuristic found no repair, never that no
repair exists.

`regionYield` is `passedRegions / totalRegions`; `chipYield` is
`passedChips / totalChips`. A chip passes only when all complete regions pass.
They measure the fraction where this heuristic found a valid repair plus
initially good items, not optimal or physical yield.
