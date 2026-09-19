import { z } from "zod";

// Authored ESM: shared directly by Pi extensions and the browser, without a
// separate extension build or a dependency on generated contracts/dist files.
export const chartProtocol = "pixel-chart/v1";
export const chartTools = Object.freeze({
  pixel_bar_chart: { kind: "bar", label: "像素柱状图" },
  pixel_line_chart: { kind: "line", label: "像素折线图" },
  pixel_area_chart: { kind: "area", label: "像素面积图" },
  pixel_pie_chart: { kind: "pie", label: "像素饼图" },
  pixel_scatter_chart: { kind: "scatter", label: "像素散点图" },
  pixel_heatmap_chart: { kind: "heatmap", label: "像素热力图" },
});
const label = (max) => z.string().trim().min(1).max(max).regex(/^[^\x00-\x1f\x7f]*$/, "标签不能包含换行或控制字符");
const number = z.number().min(-1e15).max(1e15);
const common = {
  title: label(80).describe("图表标题，说明比较的指标"),
  description: label(400).optional().describe("简要说明或结论；示例数据必须明确标注"),
  xLabel: label(48).optional(),
  yLabel: label(48).optional(),
  unit: label(20).optional().describe("数值单位，例如件、万元、%；百分比直接传入百分数"),
  source: label(240).optional().describe("数据来源或统计口径；只填写实际已知来源"),
};
const categories = z.object({
  ...common,
  labels: z.array(label(40)).min(1).max(48).describe("有序分类或时间标签，最多48项；时间间隔按等距分类展示"),
  series: z.array(z.object({
    name: label(40),
    values: z.array(number.nullable()).min(1).max(48)
      .describe("与labels逐项对应；缺失值用null，不得用0代替"),
  }).strict()).min(1).max(4).describe("最多4个系列，名称不能重复；所有系列使用同一单位"),
}).strict();
const schemas = {
  bar: categories,
  line: categories,
  area: categories,
  pie: categories.extend({
    labels: z.array(label(40)).min(1).max(12),
    series: z.array(z.object({ name: label(40), values: z.array(number.min(0).nullable()).min(1).max(12) }).strict()).length(1)
      .describe("仅一个系列；最多12个分类，数值非负，至少一个大于0；占比根据总和计算"),
  }),
  scatter: z.object({
    ...common,
    xUnit: label(20).optional(),
    series: z.array(z.object({
      name: label(40),
      points: z.array(z.object({ x: number, y: number, label: label(40).optional() }).strict()).min(1).max(100),
    }).strict()).min(1).max(4).describe("每组最多100个点，x/y为真实数值；没有有效坐标的点应先剔除并说明"),
  }).strict(),
  heatmap: z.object({
    ...common,
    xLabels: z.array(label(40)).min(1).max(24).describe("列标签"),
    yLabels: z.array(label(40)).min(1).max(24).describe("行标签"),
    values: z.array(z.array(number.nullable()).min(1).max(24)).min(1).max(24)
      .describe("按行排列的矩阵，values[y][x]；行数对应yLabels、列数对应xLabels；null表示缺失"),
  }).strict(),
};
export function chartParametersFor(kind) {
  if (!Object.hasOwn(schemas, kind)) throw new Error("不支持的图表类型");
  return z.toJSONSchema(schemas[kind], { target: "draft-7" });
}

export function createChart(kind, input) {
  if (!Object.hasOwn(schemas, kind)) throw new Error("不支持的图表类型");
  const result = schemas[kind].safeParse(input);
  if (!result.success) throw new Error(result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  const chart = { kind, ...result.data };
  const unique = values => new Set(values).size === values.length;
  if (kind === "heatmap") {
    if (!unique(chart.xLabels) || !unique(chart.yLabels)) throw new Error("热力图同一轴的标签不能重复");
    if (chart.values.length !== chart.yLabels.length || chart.values.some(row => row.length !== chart.xLabels.length)) throw new Error("矩阵的行列数必须与 yLabels、xLabels 对应");
    if (!chart.values.some(row => row.some(value => value !== null))) throw new Error("图表至少需要一个有效数值");
  } else {
    if (!unique(chart.series.map(series => series.name))) throw new Error("series 名称不能重复");
    if (kind !== "scatter") {
      if (!unique(chart.labels)) throw new Error("labels 不能重复，请加上日期或编号以区分分类");
      if (chart.series.some(series => series.values.length !== chart.labels.length)) throw new Error("每个 series.values 的长度必须与 labels 相同");
      if (!chart.series.some(series => series.values.some(value => value !== null))) throw new Error("图表至少需要一个有效数值");
      if (kind === "pie" && !chart.series[0].values.some(value => value > 0)) throw new Error("饼图至少需要一个大于0的数值");
    }
  }
  return chart;
}

export function encodeChart(chart) {
  const { kind, ...parameters } = chart;
  const text = JSON.stringify({ protocol: chartProtocol, chart: createChart(kind, parameters) });
  if (text.length > 48000) throw new Error("图表数据过大，请先聚合数据或缩短标签");
  return text;
}

/** Only completed calls of our named tools can create a chart, never prose. */
export function readChartTool(tool) {
  if (!tool || !Object.hasOwn(chartTools, tool.name) || tool.status !== "completed" || typeof tool.text !== "string" || tool.text.length > 48000) return null;
  try {
    const envelope = JSON.parse(tool.text);
    if (envelope?.protocol !== chartProtocol || !envelope.chart || envelope.chart.kind !== chartTools[tool.name].kind) return null;
    const { kind, ...parameters } = envelope.chart;
    return createChart(kind, parameters);
  } catch { return null; }
}

export function chartMarkdown(chart) {
  const escape = value => String(value).replace(/[\\`*_{}\[\]<>()#!~|]/g, "\\$&").replace(/[\r\n]/g, " ");
  const { headers, rows } = chartTable(chart);
  return [
    `### ${escape(chart.title)}（${Object.values(chartTools).find(tool => tool.kind === chart.kind).label}）`,
    chart.description ? escape(chart.description) : "",
    chart.xLabel ? `横轴：${escape(chart.xLabel)}` : "",
    chart.yLabel ? `纵轴：${escape(chart.yLabel)}` : "",
    chart.unit ? `单位：${escape(chart.unit)}` : "",
    `| ${headers.map(escape).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map(row => `| ${row.map(value => escape(value ?? "缺失")).join(" | ")} |`),
    chart.source ? `来源：${escape(chart.source)}` : "",
  ].filter(Boolean).join("\n");
}

export function chartTable(chart) {
  if (chart.kind === "scatter") return {
    headers: ["系列", "标签", `${chart.xLabel || "X"}${chart.xUnit ? `（${chart.xUnit}）` : ""}`, `${chart.yLabel || "Y"}${chart.unit ? `（${chart.unit}）` : ""}`],
    rows: chart.series.flatMap(series => series.points.map((point, index) => [series.name, point.label || String(index + 1), point.x, point.y])),
  };
  if (chart.kind === "heatmap") return { headers: [chart.yLabel || "行 / 列", ...chart.xLabels], rows: chart.yLabels.map((label, index) => [label, ...chart.values[index]]) };
  return {
    headers: [chart.xLabel || "分类", ...chart.series.map(series => `${series.name}${chart.unit ? `（${chart.unit}）` : ""}`)],
    rows: chart.labels.map((label, index) => [label, ...chart.series.map(series => series.values[index])]),
  };
}
