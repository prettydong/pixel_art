# 1024×1024 Synthetic Failure Data

For workflow demonstrations and algorithm comparisons only. This is neither measured data nor a calibrated manufacturing-defect model.

- Each sample is an independent 1024×1024 array; coordinates are zero-based, ranging from 0 to 1023.
- 100 samples in total, including 10 zero-fail samples and 18329 failure coordinates.
- roster.csv is the complete roster, including zero-fail samples; fails.csv contains only failure coordinates. Unlisted cells are passing cells.
- group identifies the synthetic distribution type, not a physical bank or redundancy resource group.
- fail_count is exact; coordinates are unique within each sample and all within bounds.
- Fixed random seed: 20260920. Reproduce with node scripts/generate-synthetic-fails.mjs <new-output-directory>.
- No spare rows/columns, resource sharing, or repair rules are configured; no solver has run and no repair rate is preset.

## Import

Upload roster.csv and fails.csv together. Set data_kind=synthetic, rows=1024, cols=1024, and coordinate base 0. Map roster fields group/sample_id/fail_count and fail fields group/sample_id/row/col; the additional data_kind column may be ignored. Confirm redundancy configuration and rules separately before evaluation.

## Distributions

| Type | Samples | Total Fails | Fails per Sample |
|---|---:|---:|---:|
| zero | 10 | 0 | 0～0 |
| random_sparse | 20 | 203 | 1～16 |
| random_dense | 10 | 794 | 38～128 |
| row_concentrated | 15 | 1878 | 69～186 |
| column_concentrated | 15 | 2103 | 65～192 |
| local_cluster | 10 | 722 | 48～113 |
| mixed | 10 | 2389 | 164～293 |
| full_row | 5 | 5120 | 1024～1024 |
| full_column | 5 | 5120 | 1024～1024 |

row_concentrated / column_concentrated contain partial failures in one row/column; full_row / full_column represent failure of an entire row/column. local_cluster occupies a 16×16 area. mixed combines row, column, local-area, and random scattered failures, without representing real occurrence proportions.
