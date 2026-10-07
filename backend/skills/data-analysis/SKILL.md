---
name: data-analysis
description: Analyze user-uploaded tables, CSV files, and DRAM failure coordinates to produce reproducible statistics, spatial distributions, and reports. Use for data-analysis tasks or explicit requests to generate synthetic data.
---

# Data Analysis

## Working Directory

Pi starts from the current user's root directory, which is not the current run's working directory. Follow the startup prompt and environment variables:

- `PIXEL_UPLOADS_DIR`: the current user's shared uploads, reused across conversations. First inspect the file inventory or user-specified attachments; keep original inputs unchanged.
- `PIXEL_WORK_DIR`: the current conversation's work directory. Place scripts, temporary data, and intermediate results here. Explicitly switch to this directory when running analysis commands.
- `${PIXEL_WORK_DIR}/artifacts/`: downloadable reports, charts, and results for the current run. Reference filenames in the final reply; the service registers these artifacts.
- `PIXEL_SKILLS_DIR`: the current user's own skills. Modify only when the user requests skill maintenance; do not write one-off results back into a skill.

Do not modify runtime configuration in `.pi/agent/`, native session files, or the service database. Shared uploads are not for intermediate artifacts; do not use another conversation's work directory for current outputs.

## Analysis Workflow

1. Read specified inputs and confirm row meanings, units, sample counts, missing values, and fields. If a filename is mentioned without a selected attachment, search shared uploads. Explain candidate files when identical names are ambiguous; do not merge them arbitrarily.
2. Check existing Python/command-line dependencies before choosing a computation method. Ordinary CSV statistics can use the Python standard library. Save reusable analysis scripts and parameters in work; record input files, definitions, and assumptions in reports.
3. Distinguish original data, computed results, and synthetic data. Generate synthetic data only when requested, recording the random seed, distribution, and parameters. Do not infer real device behavior from synthetic results with preset means.
4. Provide sufficient statistics for the question: count, mean, median, sample standard deviation, range, quantiles, and relevant between-group differences. State the standard-deviation denominator, quantile algorithm, and ratio denominators; treat zeros separately from missing values.
5. For DRAM data, first read [DRAM data definitions](references/dram.md). Compute sampling and spatial statistics separately; do not treat cumulative event counts as distinct failed-cell counts.
   For redundancy repair, repairability rates, or yield, also read `$PIXEL_SKILLS_DIR/repair-evaluation/SKILL.md` and use the framework and device in `$PIXEL_REPAIR_DIR`. First establish the data, resource quantities, and repair rules.
6. Verify that key results can be recomputed from the inputs. Label chart units and aggregation granularity. Finish with conclusions, files actually generated, and necessary conditions still missing. If the user requests manual testing, do not run application tests or browser acceptance on their behalf.
