import { t } from './i18n';
import { chartTools, encodeChart, type PixelChart } from '@pixel/contracts/charts';
import { StreamingReply } from './StreamingReply';
import { useTheme, type ThemePreference } from './theme';
import type { ReplyMessage } from './replyMessages';
import { LanguageSelect } from './LanguageSelect';

function createMessages() {
  const source = t("示例数据，不是真实测量结果");
  const examples: PixelChart[] = [
    { kind: 'bar', title: t("各 wafer 良率相对目标（90%）的差值"), xLabel: 'Wafer', labels: ['W01', 'W02', 'W03', 'W04'], series: [{ name: t("修补前"), values: [-32, -18, -41, -25] }, { name: t("修补后"), values: [3, 6, -2, null] }], unit: t("百分点"), source },
    { kind: 'line', title: t("每周缺陷数趋势"), xLabel: t("周"), labels: [t("第1周"), t("第2周"), t("第3周"), t("第4周"), t("第5周"), t("第6周")], series: [{ name: t("批次 A"), values: [18, 12, null, 9, 5, 3] }, { name: t("批次 B"), values: [15, 16, 11, 8, 6, 4] }], unit: t("个"), description: t("第3周批次 A 缺测，折线在此断开。"), source },
    { kind: 'area', title: t("各测试步骤的 fail 数"), xLabel: t("测试步骤"), labels: ['CP1', 'CP2', 'FT1', 'FT2', 'FT3'], series: [{ name: t("row 失效"), values: [24, 48, 36, 64, 52] }, { name: t("col 失效"), values: [12, 18, 16, 24, 20] }], unit: t("个"), description: t("各系列从零独立填充，面积不堆叠。"), source },
    { kind: 'pie', title: t("缺陷类型组成"), labels: [t("row 失效"), t("col 失效"), t("离散失效"), t("其他")], series: [{ name: t("失效数"), values: [42, 28, 23, 7] }], unit: t("个"), source },
    { kind: 'scatter', title: t("温度与失效数"), xLabel: t("测试温度"), xUnit: '℃', yLabel: t("失效数"), unit: t("个"), series: [{ name: t("批次 A"), points: [{ x: 25, y: 4, label: t("室温") }, { x: 40, y: 7 }, { x: 85, y: 19 }] }, { name: t("批次 B"), points: [{ x: 25, y: 3 }, { x: 50, y: 9 }, { x: 85, y: 16 }] }], description: t("X 轴按真实数值间隔排列。"), source },
    { kind: 'heatmap', title: t("阵 col 失效分布"), xLabel: t("col 分区"), yLabel: t("row 分区"), unit: t("个"), xLabels: ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'], yLabels: ['R0', 'R1', 'R2', 'R3'], values: [[0, 2, 4, 6, 2, 0], [1, 5, 15, 21, 8, 2], [0, 3, 12, 17, null, 1], [0, 0, 2, 4, 1, 0]], source },
  ];

  // Use the actual tool-result envelope and reply renderer in the manual gallery.
  const messages: ReplyMessage[] = examples.map((chart, index) => ({
    id: `chart-demo-${index}`, role: 'assistant', text: '', files: [], runId: `chart-demo-run-${index}`, createdAt: 0,
    toolCalls: [{ id: `chart-demo-tool-${index}`, name: Object.entries(chartTools).find(([, tool]) => tool.kind === chart.kind)![0], status: 'completed', text: encodeChart(chart) }],
  }));

  return messages;
}

export function ChartDemo() {
  const messages = createMessages();
  const [theme, setTheme] = useTheme();
  return <main className="chart-demo">
    <header><h1>{t("图表示例")}</h1><a href={window.location.pathname}>{t("返回工作台")}</a></header>
    <LanguageSelect />
    <p>{t("以下均为固定演示数据；在真实对话中，AI 会根据你的数据生成类似图表。")}</p>
    <label>{t("主题") + " "}<select value={theme} onChange={event => setTheme(event.target.value as ThemePreference)}><option value="system">{t("跟随系统")}</option><option value="light">{t("亮色")}</option><option value="dark">{t("暗色")}</option></select></label>
    {messages.map(message => <StreamingReply key={message.id} message={message} pending={false} />)}
  </main>;
}
