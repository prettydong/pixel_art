# Technical Report

IEEE conference-format report describing Pixel Chat. Build with [Tectonic](https://tectonic-typesetting.github.io):

```bash
tectonic main.tex
```

Evaluation numbers come from the repair-job summaries (`result.jsonl`) of the nine DEJOA jobs; the source specifications are the Markdown files at the repository root.

The yield comparison table (the greedy-gap audit) is reproduced, read-only, with:

```bash
node docs/report/scripts/column-first-audit.mjs data/users/<userId>/repair-jobs
```

The engineering-effort estimate uses the observed gross `dev.hpp` line counts
(280, 280, 212), an assumed manual rate of 100 lines per eight-hour
engineer-day, and an assumed allowance of at most two engineer-hours per
harness-assisted configuration, including review. It is a planning scenario,
not a measured human productivity result. A configuration is counted once
across its three wafer jobs. The baseline is 61.76 hours, the assisted budget
6 hours, and the released effort 55.76 hours (90.3%, 10.3x evaluation capacity).

