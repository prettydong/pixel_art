# DRAM Data Definitions

Prioritize input metadata. Do not hard-code the following example's dimensions, sample counts, or means as defaults for every task.

Project A/B/C example: `metadata.json` defines a 1024×1024 array and 100 samples per group. `A_fails.csv`, `B_fails.csv`, and `C_fails.csv` contain sparse coordinates with fields `group,sample_id,row,col`. Rows/columns are zero-based and sample IDs one-based. Records represent fail=1; all other cells are pass=0. `sample_counts.csv` is the complete sample roster, including zero-fail samples; do not infer total samples from coordinate tables alone. `summary.csv` contains precomputed answers for cross-checking, not a replacement for original-data analysis.

First verify coordinate bounds, uniqueness within each group/sample, and sample membership in the roster. Flag duplicates, missing metadata, or inconsistent counts rather than silently deduplicating or filling missing samples with zeros.

- Per-sample fail count: number of distinct failed coordinates in that sample.
- Cell failure proportion: per-sample fail count / total array cells; multiply by 1,000,000 for ppm. Do not call this BER without read/write operation counts.
- Cumulative failure events: sum of fail counts across all samples.
- Distinct failed cells: size of the coordinate union across samples within a group. Repeated cells are coordinates appearing at least twice; repeated events are cumulative events minus union size.
- Count variability: sample standard deviation (n−1; undefined for n<2), CV (undefined for zero mean), P95/P99, and peak. State whether quantiles use nearest rank or interpolation.
- Spatial distribution: affected row/column counts, fails per row/column, repeated addresses, and heatmaps aggregated at an explicit grid size. Dark heatmap colors do not directly prove physical hotspots. Use the same color scale across groups or explain normalization.

This example generates counts using Dirichlet weights and multinomial allocation with fixed totals. A/B/C means of 50/60/70 are imposed constraints. The 100 counts within each group share a total constraint, so an independent-identically-distributed assumption cannot support inference about real means. Coordinates are resampled uniformly each time, without permanent bad cells or temporal mechanisms. Reassess other inputs according to their actual sampling mechanism.

Repair rates or yield also require spare-row/column counts, repair rules, ECC configuration, and passing criteria. Do not conclude repairability from fail counts alone.
