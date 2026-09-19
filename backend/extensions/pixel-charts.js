import { chartParametersFor, chartTools, createChart, encodeChart } from "@pixel/contracts/charts";

const descriptions = {
  bar: "分类比较，支持最多4个系列的分组柱状图；纵轴包含零。",
  line: "按标签顺序等距展示趋势；null处断开，不插值；纵轴包含零。",
  area: "按标签顺序等距展示非堆叠面积图，各系列独立从零填充；null处断开。",
  pie: "展示非负数据的组成比例；仅一个系列，最多12个分类，至少一个正值。",
  scatter: "使用真实数值X/Y坐标，查看变量关系；每系列最多100个点，最多4组。",
  heatmap: "展示行列矩阵强度；最多24行24列，自动使用五档色阶，null表示缺失。",
};

// Loaded explicitly by the server. No interactive Pi UI or filesystem output.
export default function pixelCharts(pi) {
  for (const [name, { kind, label }] of Object.entries(chartTools)) {
    pi.registerTool({
      name,
      label,
      description: `${label}：${descriptions[kind]}在聊天回复中直接展示。传入已计算的数据；不读取文件、不执行统计。所有系列使用同一坐标单位。`,
      promptSnippet: `${label}，直接在聊天中展示数据`,
      promptGuidelines: [
        `需要${label}时调用 ${name}。先核对或计算数据，不编造数值或来源；示例数据须在 description 中标明。`,
        `${name} 的数据与标签必须一一对应。数据过多时先合理聚合并说明口径。工具成功后图表已展示，不必复述工具返回的 JSON。`,
      ],
      parameters: chartParametersFor(kind),
      async execute(_toolCallId, parameters, signal) {
        if (signal?.aborted) throw new Error("图表生成已取消");
        const chart = createChart(kind, parameters);
        return {
          content: [{ type: "text", text: encodeChart(chart) }],
          details: { chart },
        };
      },
    });
  }
}
