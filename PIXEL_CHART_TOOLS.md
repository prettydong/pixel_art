# Pi Pixel-Chart Tools

The service explicitly loads `backend/extensions/pixel-charts.js`, registering the following six tools in each new Pi process. Automatic discovery of other extensions remains disabled. No changes to user `.pi/agent/settings.json` files or model configuration are required.

| Tool | Purpose | Input and Limits |
| --- | --- | --- |
| `pixel_bar_chart` | Multi-series category comparison | `labels` + `series[].values`; grouped bars; y-axis includes zero |
| `pixel_line_chart` | Ordered trends | Same input; equally spaced category axis; gaps at missing values |
| `pixel_area_chart` | Ordered trends and magnitude | Same input; non-stacked; each series filled independently from zero |
| `pixel_pie_chart` | Composition proportions | Same input; one series, at most 12 items, nonnegative with at least one positive value |
| `pixel_scatter_chart` | Relationship between two numeric variables | `series[].points[{x,y,label?}]`; actual numeric coordinates; at most 100 points per series |
| `pixel_heatmap_chart` | Row/column matrix distribution | `xLabels`, `yLabels`, `values[y][x]`; at most 24×24; five equal-width color bands |

All tools require `title` and optionally accept `description`, `xLabel`, `yLabel`, `unit`, and `source`. Scatter charts also accept `xUnit`. Category charts allow at most 48 labels; category and scatter charts allow at most 4 series sharing the same unit. Labels and series names must be unique. Values must be finite and within ±10^15. Pie charts cannot contain negative values or be entirely zero; other types allow negative and all-zero values. Category charts and heatmaps represent missing values with `null`, without zero filling or interpolation across gaps; scatter charts require complete numeric coordinates.

Tools only validate and return chart data; they do not read files or compute statistics. The agent should analyze data using existing scripting tools before submitting computed results. Aggregate data exceeding the limits and explain the aggregation basis. Label example values as examples and do not invent sources.

## Parameter Examples

Calling `pixel_bar_chart`, `pixel_line_chart`, or `pixel_area_chart`:

```json
{
  "title": "Quarterly sales",
  "labels": ["Q1", "Q2", "Q3"],
  "series": [
    { "name": "Product A", "values": [120, 145, 132] },
    { "name": "Product B", "values": [90, null, 110] }
  ],
  "unit": "items",
  "description": "Example data; Product B is missing for Q2"
}
```

Calling `pixel_pie_chart`:

```json
{"title":"Defect composition","labels":["Row failures","Column failures","Scattered failures"],"series":[{"name":"Fail count","values":[42,28,30]}],"unit":"fails","description":"Example data"}
```

Calling `pixel_scatter_chart`:

```json
{"title":"Temperature and fail count","xLabel":"Temperature","xUnit":"℃","yLabel":"Fail count","unit":"fails","series":[{"name":"Batch A","points":[{"x":25,"y":4},{"x":40,"y":7},{"x":85,"y":19}]}],"description":"Example data"}
```

Calling `pixel_heatmap_chart`:

```json
{"title":"Array distribution","xLabels":["C0","C1","C2"],"yLabels":["R0","R1"],"values":[[0,2,8],[1,null,15]],"unit":"fails","description":"Example data"}
```

## Protocol and Rendering

`@pixel/contracts/charts` is the shared ESM module with type declarations, maintaining parameter JSON Schemas, runtime validation, versioned results, data tables, and Markdown export. No separate extension build is required; deployment must include `backend/extensions/` and `packages/contracts/charts.js`.

Each tool returns one text content block: `{"protocol":"pixel-chart/v1","chart":{...}}`, and retains data in Pi's native `details.chart`. Data travels through existing `tool.status.text`, database events, and SSE, without a new database table. Results are limited to 48000 characters, below the existing 64000-character tool-output truncation threshold.

The frontend recognizes only successful results from these named tools and revalidates the data. Ordinary Markdown, arbitrary code blocks, failed calls, and running calls do not trigger charts. Invalid results show a notice, while arguments and raw output remain in tool details. Charts are independent of the "Reasoning and tools" collapsed area and are restored from saved events after refreshes or conversation switches. If the service stops before recording a completion event, persisted native Pi tool results can restore the chart, deduplicated by call ID. Copying replies and exporting Markdown includes the original numeric tables.

SVG coordinates and display dimensions correspond to integer design pixels. Line and pie outlines are rasterized, with Fusion Pixel text at 12 grid units. Areas use pixel-dot patterns; colors come from semantic theme variables. Narrow windows scroll only inside chart containers without scaling pixel units. Data tables retain complete labels, exact values, and missing-value information; axis ticks may be abbreviated.

## Manual Demo and Acceptance Checks

Visit `http://192.168.31.219:5173/?demo=charts` for six fixed examples, without login or model calls. The login page and model menu also offer "View pixel-chart demo". The address changes with the machine's LAN IP.

In a real conversation, enter:

> Please use the pixel-chart tools to draw a bar chart and a line chart: January 12, February 18, March 15, in items. This is demo data.

The following checks are pending manual execution and do not indicate that they have passed:

1. Check all six examples, light/dark themes, local scrolling on narrow screens, and browser zoom. Text and outlines must follow the pixel grid.
2. Use arrow keys or the pointer to inspect values in category, scatter, and heatmap charts. Expand data tables to inspect complete labels and values.
3. Check multiple series, negatives, all zeros, a single point, and missing values; pie-chart nonnegativity, unequal numeric spacing in scatter charts, and constant/missing heatmap cells.
4. Successful real Pi calls must display charts in replies. Invalid parameters must return tool errors, allowing the model to correct them and retry.
5. Charts must not disappear or duplicate after refreshing, switching conversations, or reconnecting SSE. Copied replies and Markdown exports must include chart data.
6. Stopping an unfinished tool must not show fabricated results. Charts from completed tools remain. Existing tools such as bash/read must still work.

In accordance with the project agreement, this development did not run tests, builds, type checks, automated browser acceptance checks, or real model calls.
