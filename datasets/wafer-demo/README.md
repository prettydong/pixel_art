# Synthetic Wafer Data

For development and demos only; this does not represent real manufacturing defect distributions or yield.

Product structure: 64 chips per wafer, 8 regions per chip, and 1024 × 1024 per region. All indices start at 0.

Random seed: 20260926; pattern: mixed; the first 1 wafer has no fails. Each nonempty region has exactly 8 unique fails; remaining regions have no fails.

Create a product with matching structure on the data page and import the .pwafer files. manifest.json stores generation parameters, per-wafer totals, and SHA-256 hashes; do not import it as a wafer.

See the project's WAFER_FORMAT.md for the format and reading/writing methods. The complete chip/region roster is defined by the header structure; nonempty-record counts must not replace total counts.
