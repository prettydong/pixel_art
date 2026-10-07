# DEJOA built-in demo

The workspace's **Load DEJOA demo** button creates a fresh task with these configurations and fixed synthetic inputs. It prepares nine draft combinations but never calls an agent or starts Solver. The presenter must click **Run list (9)** to execute them. Loading again creates another fresh task; an identical request retry reuses the task.

- Product: DEJOA; 200 chips per wafer, 16 regions per chip, 32768 rows × 2048 columns per region.
- Three wafers: DEJOA-001, DEJOA-002, DEJOA-003; the exact inputs from the original DEJOA evaluation.
- Mixed spatial-gamma-poisson-v2 generation, disk-grid-v1; seeds 20260926–20260928, mean 100 fails per region (1600 per chip), strength 12, dispersion 4. No forced zero-fail chips or wafers.
- CCR: 16 sections, 2048 rows each; one section per segment and eight column subgroups per segment. Columns use `col % 8`. Each region has its own shared global spare-row pool.
- Variants: R128 C2, R64 C2, R128 C1. R is global spare rows per region; C is spare columns per subgroup per section. Resources do not cross regions, segments, or column subgroups.

`manifest.json` records hashes, layouts, fail counts, and generation parameters. Inputs are validated before loading and reused only when an owned wafer matches the exact data and metadata. Existing tasks, uploaded inputs, and results are retained. No solver code, historical yields, conclusions, model credentials, or user identifiers are included in this bundle. These are demonstration data, not manufacturing measurements.
