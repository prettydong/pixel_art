# Region / Segment / CCR Architecture Definitions

The following definitions are confirmed for this project: smart-eval's bank corresponds to a region here; bigSection is consistently renamed segment; only CCR is supported. Segments retain smart-eval's section/subsection row-address mapping.

## Data Hierarchy and Repair Scope

```text
Product
└─ Wafer
   └─ Chip
      └─ Region (a bank; independent repair unit)
         ├─ Global spare-row pool (128 by default, shared by all segments)
         └─ Multiple Segments
            └─ Independent CCR subgroups and spare-column capacities
```

User-confirmed DEJOA data structure: 1000 chips per wafer, 16 regions per chip, and **32768 rows × 2048 columns** per region.

| Name | Definition |
| --- | --- |
| Region | An independent row/column address space containing multiple segments; corresponds to a smart-eval bank |
| Segment | A row range within a region and a local CCR column-redundancy resource unit; corresponds to the former bigSection |
| Global spare-row pool | 128 rows per region by default, shared by all segments; one row repair covers all columns of one original row in the region and consumes 1 spare row |
| CCR subgroup | A resource group within each segment, determined by the original zero-based column address modulo the subgroup count |
| CCR spare column | One resource repairs one original column within one segment; the same column in different segments consumes resources separately |
| Per-subgroup capacity | Each segment independently has the same configured subgroup capacities; do not mistake these for totals for the whole region |

Spare rows are shared across all segments within a region, but not across regions. CCR spare columns cannot be borrowed across segments, regions, or subgroups. Column addresses are not folded.

## Segment Row-Address Mapping

Retain the original algorithm and rename only the public terminology for bigSection and colseg. Normalize input addresses to zero-based first, then use integer division:

```python
section_group = row // section_group_size
subsection = (row % section_group_size) // subsection_size \
             + section_group * subsections_per_group
segment = subsection // sections_per_segment
```

| Parameter | Meaning |
| --- | --- |
| `section_count` | Total sections in one region |
| `sections_per_segment` | Sections in each segment; corresponds to the former `colseg` |
| `section_group_size` | Row-address span of a section group |
| `subsection_size` | Row-address step for partitioning subsections within a section group |
| `subsections_per_group` | Subsection-number step between adjacent section groups |

Derived from configuration:

```text
segment count = section_count / sections_per_segment
region row count = (section_count / subsections_per_group) * section_group_size
```

Requirements:

- All partition parameters must be positive integers.
- `section_count` must be divisible by both `subsections_per_group` and `sections_per_segment`.
- The derived region row count must equal the actual array row count.
- `section_group_size <= subsection_size * subsections_per_group`, so final rows do not map beyond the allocated section indices.

`section_group_size` does not have to equal `subsection_size * subsections_per_group`. Do not simply divide the region's rows equally among segments.

Example: `section_count=96, sections_per_segment=2, section_group_size=2048, subsection_size=344, subsections_per_group=6` gives **32768 rows and 48 segments**. The first three segments span `0..687`, `688..1375`, and `1376..2047`, with lengths 688, 688, and 672. The next section group continues from row 2048. These ranges are derived from the formula.

Mapping reference: [smart-eval RowLayout](/home/zdong/raDev/smart-eval/backend/algo/repair_core/src/region_arch.cpp:39).

## CCR Resource Mapping and Repair Actions

```python
ccr_group = zero_based_col % ccr_groups_per_segment
pool = (region, segment, ccr_group)
column_action = (region, segment, original_col)
```

`ccr_spares_per_group[g]` configures the **capacity of subgroup g in each segment**. Different subgroups may have different capacities; these capacities repeat independently in every segment.

For example, with 8 CCR subgroups and a capacity of 2 per group:

- Columns 0 and 8 in the same segment compete for subgroup 0 capacity; repairing both consumes 2 spare columns.
- Fails in the same column in two segments require 1 spare column in each segment. One spare cannot cover the entire region.
- All fails on one original row are covered by 1 global spare row. Distinct row addresses requiring row repair across all segments jointly consume the region's default capacity of 128 rows.
- The number of fails an action covers does not determine resource consumption. Each row or local-column action consumes 1 unit from its corresponding pool.

```text
row pools per region = 1
global spare-row capacity per region = spare_rows (128 by default)
CCR pools per region = segment count × subgroups per segment
total spare-column capacity per region = segment count × sum(subgroup capacities)
```

The total is for display; solving still constrains each independent resource pool. Reference: [smart-eval CCR](/home/zdong/raDev/smart-eval/backend/algo/repair_core/device/standard_devices.cpp:172).

## Current Configuration Format

Frontend architecture definitions use `pixel-architecture version:2, model:"region-ccr"`. The following format example uses the user-confirmed default of 128 global spare rows per region. The 2 spare columns per group remain an editable example, **not a confirmed DEJOA column-redundancy quantity**.

```json
{
  "kind": "pixel-architecture",
  "version": 2,
  "template_id": "ccr-segmented",
  "model": "region-ccr",
  "array": {"rows": 32768, "cols": 2048, "coordinate_base": 0},
  "device": {
    "spare_rows": 128,
    "ccr_groups_per_segment": 8,
    "ccr_spares_per_group": [2, 2, 2, 2, 2, 2, 2, 2],
    "row_layout": {
      "section_count": 96,
      "sections_per_segment": 2,
      "section_group_size": 2048,
      "subsection_size": 344,
      "subsections_per_group": 6
    }
  },
  "notes": ""
}
```

The frontend provides only CCR segmented and single-segment presets. Common settings include row/column dimensions, region-global spare rows, subgroup counts, and capacities; section/subsection parameters are under advanced options. See [architectureTemplates.ts](/home/zdong/raDev/pixel_art/fronted/src/architectureTemplates.ts) for parameter serialization and validation.

## Execution, Drawing, and Statistical Definitions

- `backend/repair-evaluation/device.py` implements the coverage relationships and capacity constraints above. Each `Sample` is a region; the row-pool key is `region_rows`, and column-pool keys are `segment_{s}_ccr_{g}`.
- Create candidates only for rows and local columns containing fails. Zero-fail regions must still appear in the complete roster.
- The experiment framework's top-level format remains `schema_version:1`. Put the selected architecture's `array/device` into the experiment configuration; its version is distinct from the frontend architecture version.
- The service supplies each conversation with an independent `ccr-device-v3.py`, exposing its path through `PIXEL_CCR_DEVICE` and task context to avoid overwriting user-modified `device.py` files.
- Generate a plan with `run.py plan --device "$PIXEL_CCR_DEVICE" --config ... --out ...`; `run.py run --plan ... --out ...` reads the same device from the plan. Execution still validates code/data fingerprints and archives snapshots.
- Expand original `.pwafer` data into a complete roster and fail coordinates by wafer/chip/region identity. Do not merge matching row/col addresses from all regions into one sample.
- The framework's `repair_yield` is measured per region. A chip passes only if all its regions are repairable; unknown results do not justify declaring a chip unrepairable. Report scripts must explicitly aggregate chips/wafers; a region ratio must not be called chip yield.
- Previews draw actual boundaries using the same segment formula and label global spare-row quantities and per-segment CCR subgroups/column capacities. The larger row/column dimension is horizontal (columns are horizontal when equal). For DEJOA, 32768 rows are horizontal and 2048 columns vertical. Only the display is transposed; original addresses and repair-resource mapping remain unchanged.

This integration covers configuration, candidate modeling, and agent rule documentation. Actual DEJOA repair evaluation has not been performed, so no yield is reported from it.
