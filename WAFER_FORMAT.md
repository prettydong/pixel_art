# Product and Wafer Data (PXLWAF1)

A product fixes `chipCount=k`, `regionCount=n`, `rows`, and `cols`. It contains multiple wafers; each wafer has exactly k chips, each chip exactly n regions, and all regions the same dimensions. Product structure is immutable after creation; use a new product for another structure. Products and wafers belong to the current user, and the same wafer file may be linked to multiple tasks.

One `.pwafer` file represents one wafer. All chip, region, row, and col indices start at 0. Fails record only failed-cell coordinates, without failure values, test rounds, or redundancy resources. Files with matching structure may be imported into the selected product. Product and wafer names are not embedded in the file; they are stored in the catalog database and generation manifest.

## Binary Layout

There is no outer archive or text-coordinate layer. The 44-byte header uses little-endian uint32 values; the payload uses unsigned delta varints sorted by region and cell address.

| Offset (bytes) | Length | Content |
| --- | --- | --- |
| 0 | 8 | Magic `PXLWAF1\0` (hex `50 58 4c 57 41 46 31 00`), format version 1 |
| 8 | 4 | flags: bit 0 marks synthetic data; all other bits must be 0 |
| 12 | 4 | chipCount |
| 16 | 4 | regionCount (per chip) |
| 20 | 4 | rows (per region) |
| 24 | 4 | cols (per region) |
| 28 | 4 | Total fails across the wafer |
| 32 | 4 | Nonempty region count |
| 36 | 4 | Payload length in bytes |
| 40 | 4 | CRC-32/ISO-HDLC over header bytes 0..39 concatenated with the payload, excluding this field |
| 44 | Variable | payload |

CRC uses the reflected polynomial `0xedb88320`, with initial and final XOR values of `0xffffffff`. It detects corruption but does not authenticate content or provenance.

The payload records only regions with fails. Each group contains, in order:

1. A `regionIndex` delta, where `regionIndex = chip * regionCount + region`. The first group is relative to 0; later groups are relative to the previous group.
2. The fail count for this region, which must be greater than 0.
3. Ascending cell-address deltas, where `position = row * cols + col`. The first address in each group is relative to 0; later addresses are relative to the previous address in that group.

Each integer uses the shortest unsigned LEB128 representation, at most 5 bytes and within the unsigned 32-bit range. The first region/address delta may be 0; subsequent deltas must be positive, ensuring strict order without duplicates.

The header explicitly preserves the complete structure; omitted regions have 0 fails. An all-zero-fail wafer is only 44 bytes, while all chips and regions still exist. Sparse storage does not allocate a row × col matrix. Compression depends on the spatial distribution; dense failures can be larger than a bitmap. This version does not adaptively switch encodings.

Current implementation limits: each dimension 1..1000000; k × n ≤ 1000000; rows × cols ≤ 4294967295; per wafer ≤ 5000000 fails, ≤ 100000 nonempty regions, and ≤ 25 MiB. The server also enforces its actual upload limit. Decoding rejects mismatched structures, invalid CRCs, unknown flags, out-of-bounds values, duplicates, nonminimal varints, truncation, and trailing bytes.

## Generate Test Data

No build is required; use Node directly:

```bash
node scripts/generate-wafer-fails.mjs \
  --out datasets/wafer-spatial-demo \
  --chips 1000 --regions 16 --rows 32768 --cols 2048 \
  --wafers 3 --pattern mixed --mean-fails-per-region 100 \
  --strength 12 --dispersion 4 --seed 20260926
```

Outputs three wafers, generation parameters and a SHA-256 manifest, and synthetic-data notes. Supported spatial patterns include random, center, donut, edge ring, edge local, local, scratch, and mixed. `--mean-fails-per-region` is the target mean fail count per region, defaulting to 100; internally it is converted to a per-chip mean using the product's region count. Set it to 0 for all-zero data. See [WAFER_SPATIAL_MODEL.md](WAFER_SPATIAL_MODEL.md) for the model and research basis. Existing files with different content are not overwritten.

Create a product with matching structure on the data page and import `.pwafer` files. The data page consistently uses this format and does not provide old CSV previews or format-conversion entry points.

## Read from Scripts

Use the read-only commands to inspect a summary or a specific region (up to 1000 coordinates, without expanding the whole wafer):

```bash
node scripts/read-wafer.mjs --file datasets/wafer-demo/wafer-002.pwafer
node scripts/read-wafer.mjs --file datasets/wafer-demo/wafer-002.pwafer --chip 0 --region 0 --limit 50
```

Chat-task context includes linked wafers' product names, complete structure, file IDs, and the tool path above. Detailed coordinates stay in the binary file and are computed by scripts as needed.

The codec is an ES module without Node-specific dependencies; the frontend, backend, and generator share one implementation:

```js
import { readFileSync } from 'node:fs';
import { decodeWafer } from './packages/contracts/wafer-data.js';

const wafer = decodeWafer(readFileSync('datasets/wafer-demo/wafer-002.pwafer'));
for (const group of wafer.groups) {
  const chip = Math.floor(group.regionIndex / wafer.layout.regionCount);
  const region = group.regionIndex % wafer.layout.regionCount;
  for (const position of group.positions) {
    const row = Math.floor(position / wafer.layout.cols);
    const col = position % wafer.layout.cols;
    // Use chip, region, row, and col; empty regions are defined by layout.
  }
}
```

Import through the package as `@pixel/contracts/wafer-data`. Generators call `encodeWafer({ layout, groups, synthetic })`, requiring groups and each group's positions to be strictly ascending without duplicates. A synthetic flag is not proof of trustworthy provenance.
