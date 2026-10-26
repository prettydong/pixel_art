# CSL rule check script

The user describes DRAM column rules in `rules.json`. Write `csl-check.mjs` so the
CSL rules page can tell the user whether the CSLs they mark as used break a rule.

## Address model

- A col plane (CP) has `cslPerCp` (64) column select lines (CSL). One CSL selects one col.
- `cpCount` CPs give `cpCount * cslPerCp` CSLs. A CSL is named by its global index
  `g = cp * cslPerCp + csl` (0-based), which is also its col index.
- CP `cp = Math.floor(g / cslPerCp)`, CSL within the CP `csl = g % cslPerCp`.
- "Used" means the user assigned that CSL (col). A rule usually says that using some
  CSL makes other CSLs unusable, or limits how CSLs may be combined.

## Contract

`csl-check.mjs` is a single ES module with no imports. It must be pure and
deterministic: no file, network, timer, random or global state; no `eval`.

```js
// Your reading of each user rule, in the user's language. `text` quotes or
// paraphrases the user's rule; `summary` says exactly what the script checks,
// including any assumption you made where the rule was ambiguous.
export const rules = [{ id: 'R1', text: '…', summary: '…' }];

// input: { cpCount, cslPerCp, used }; `used` is a sorted array of unique global CSL indices.
export function check(input) {
  return {
    // One entry per broken rule instance. `csls` lists the used CSLs involved.
    violations: [{ rule: 'R1', csls: [3, 35], message: 'CP0 CSL3 and CSL35 are both used' }],
    // Unused CSLs that can no longer be used: adding one would break a rule.
    // `rule` names the rule that blocks it.
    blocked: [{ csl: 67, rule: 'R1' }],
  };
}
```

- Name CSLs in messages as `CP<cp> CSL<csl>` and keep each message to one short sentence.
- `blocked` must be consistent with `violations`: a simple correct way is to try each
  unused CSL, add it to `used`, and see which rules newly break.
- `check` runs on every click for up to 4096 CSLs; keep it well under 100 ms.
- If a rule cannot be decided from CSL usage alone, keep it in `rules` with a
  `summary` that says it is not checked, and do not invent a parameter.

## Self-test

```sh
"$PIXEL_NODE" "$PIXEL_CSL_SMOKE" csl-check.mjs <cpCount>
```

It loads the module the way the server does and prints `{"ok":true}` or the error.
The server runs the same test before it shows the script to the user.
