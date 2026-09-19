export type ChartCommon = {
  title: string;
  description?: string;
  xLabel?: string;
  yLabel?: string;
  unit?: string;
  source?: string;
};
export type CategoryChart = ChartCommon & {
  kind: "bar" | "line" | "area" | "pie";
  labels: string[];
  series: { name: string; values: (number | null)[] }[];
};
export type ScatterChart = ChartCommon & {
  kind: "scatter";
  xUnit?: string;
  series: { name: string; points: { x: number; y: number; label?: string }[] }[];
};
export type HeatmapChart = ChartCommon & {
  kind: "heatmap";
  xLabels: string[];
  yLabels: string[];
  values: (number | null)[][];
};
export type PixelChart = CategoryChart | ScatterChart | HeatmapChart;
export const chartProtocol: "pixel-chart/v1";
export const chartTools: Readonly<Record<"pixel_bar_chart" | "pixel_line_chart" | "pixel_area_chart" | "pixel_pie_chart" | "pixel_scatter_chart" | "pixel_heatmap_chart", { kind: PixelChart["kind"]; label: string }>>;
export function chartParametersFor(kind: PixelChart["kind"]): Record<string, unknown>;
export function createChart(kind: PixelChart["kind"], input: unknown): PixelChart;
export function encodeChart(chart: PixelChart): string;
export function readChartTool(tool: { name: string; status: string; text?: string }): PixelChart | null;
export function chartMarkdown(chart: PixelChart): string;
export function chartTable(chart: PixelChart): { headers: string[]; rows: (string | number | null)[][] };
