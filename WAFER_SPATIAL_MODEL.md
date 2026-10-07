# Wafer Spatial Distribution and Heatmaps

## What the Research Supports

Wafer fails do not follow a universal "more toward the edge" rule. Published research includes center, donut, edge-ring, edge-local, local-cluster, scratch, and random patterns. WM-811K research addresses die/chip-level pass/fail patterns; it does not directly provide memory-cell fail counts or generation parameters for each DEJOA chip. [Jeong et al., Scientific Reports, 2023](https://www.nature.com/articles/s41598-023-34147-2); [Wu et al., IEEE TSM, 2015](https://ieeexplore.ieee.org/document/6932449/).

Bae, Hwang, and Kuo use chip spatial position as an explanatory variable for defect counts, comparing Poisson, negative-binomial, and zero-inflated Poisson models. This supports considering spatial position, clustering, and zero-defect chips in count modeling; it does not replace measured calibration for a specific product. [IIE Transactions, 2007, DOI: 10.1080/07408170701275335](https://www.tandfonline.com/doi/full/10.1080/07408170701275335).

This project borrows only these patterns and statistical modeling ideas. The values, pattern functions, and combinations below are development assumptions, not fitted to measured DEJOA data, and must not be used to claim real yield or infer process causes.

## Position: disk-grid-v1

The user requested a chip grid filling a disk. Current `.pwafer` files have no measured physical chip coordinates, so the layout selects the K integer grid points closest to the center and numbers them from top to bottom, left to right. Equal-radius positions are ordered by y, then x. There are exactly K chips without interior holes; some edge positions may be asymmetric depending on K. Layout, generation, and rendering share `createWaferMap()`.

Coordinates form a schematic grid and do not represent wafer diameter, die dimensions, scribe lanes, notch orientation, actual wafer-sort numbering, or measured positions. This limitation is also labeled when importing external `.pwafer` files. Automatic spatial generation and disk previews currently support up to 10000 chips; coordinate previews within a region do not depend on this limit.

## Counts: spatial-gamma-poisson-v2

Assign each chip a position score `s_i`. Supported patterns are random, center, donut, edge-ring, edge-local, local, scratch, and mixed; local positions and directions come from the recorded random seed. Random uses equal scores. Other patterns use radial, local two-dimensional Gaussian, or narrow-band functions; mixed combines donut, edge-local, and scratch scores.

```text
w_i = exp(strength * s_i) / mean_j(exp(strength * s_j))
G_i ~ Gamma(shape=dispersion, scale=1/dispersion)
lambda_i = meanFails * w_i * G_i
N_i ~ Poisson(lambda_i)
```

Thus `meanFails` is the unconditional target mean per chip across the wafer; individual generated outcomes vary. The generator no longer probabilistically forces entire chips to zero. Poisson sampling at low-intensity positions may still naturally produce zeros. Smaller `dispersion` means greater random variation between chips. Defaults of `100 fails per region, strength=12, dispersion=4` (1600 fails per DEJOA chip) are merely examples for making patterns visible.

Each chip's `N_i` is distributed across a region sequence with a random starting point, then unique row-major addresses are sampled without replacement within regions. This is a schematic region allocation without modeling actual bank, bitline, or wordline failure mechanisms. All zero-fail chips and regions are retained. Exceeding limits for total fails, coordinate capacity, nonempty regions, or file size produces an explicit error rather than silently trimming data.

## Heatmap Meaning

- Each cell represents one chip; its value is exactly the sum of `positions.length` over all decoded regions in that chip.
- Gray means zero fails; blank space outside the disk means no chip. These are distinct states.
- Positive values use five discrete sequential color bands, without color smoothing or spatial interpolation. The legend explicitly shows each band's integer range.
- Linear and `log1p` logarithmic scales are available. The logarithmic scale makes small values and clusters visible together; displayed values remain raw fail counts.
- Color bands are based on the current wafer's maximum. Comparisons across wafers must use legends and exact values, rather than colors alone.
- Clicking or selecting a chip with the keyboard updates the region preview. Zero-based chip/region/row/col indices are consistent across all views.
- The proportion of chips containing fails is not called "yield", since redundancy repair and product qualification have not been performed.

## Generation, Saving, and Reproduction

The webpage's "Generate Wafer" computes in a Web Worker. On completion, it saves `.pwafer` through the same import flow, links it to the current task, and automatically displays the whole-wafer heatmap. The pattern, seed, and parameters are saved in the wafer catalog record and passed into chat-task context. The binary contains only the synthetic flag and fail data; downloading and reimporting the binary alone does not restore generation parameters.

The CLI also outputs a manifest containing each wafer's parameters, SHA-256, and statistical summary for direct reproduction:

```bash
node scripts/generate-wafer-fails.mjs \
  --out datasets/dejoa-spatial-demo/edge-ring \
  --prefix DEJOA-edge-ring \
  --chips 1000 --regions 16 --rows 32768 --cols 2048 \
  --wafers 1 --pattern edge-ring --mean-fails-per-region 100 \
  --strength 12 --dispersion 4 --seed 20260926
```

Identical parameters, seed, and model version produce identical binaries. Imported-file colors are computed only from actual coordinates; filenames or pattern labels do not fabricate heatmaps. Browser and Node share the generation module; floating-point math differences between JavaScript engines may affect borderline random sampling. Use the binary SHA-256 for rigorous archiving.
