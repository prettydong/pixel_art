import { chartTools, encodeChart, type PixelChart } from '@pixel/contracts/charts';
import { StreamingReply } from './StreamingReply';
import { useTheme, type ThemePreference } from './theme';
import type { ReplyMessage } from './replyMessages';

const source = '本地演示数据，不代表真实业务结果';
const examples: PixelChart[] = [
  { kind: 'bar', title: '各区域季度增量', labels: ['华东', '华南', '华北', '西部'], series: [{ name: '一季度', values: [32, 18, -8, 0] }, { name: '二季度', values: [41, 24, -3, null] }], unit: '万元', source },
  { kind: 'line', title: '每周缺陷数趋势', labels: ['第1周', '第2周', '第3周', '第4周', '第5周', '第6周'], series: [{ name: '批次 A', values: [18, 12, null, 9, 5, 3] }, { name: '批次 B', values: [15, 16, 11, 8, 6, 4] }], unit: '个', description: '第3周批次 A 缺测，折线在此断开。', source },
  { kind: 'area', title: '每日请求量', labels: ['周一', '周二', '周三', '周四', '周五'], series: [{ name: '读取', values: [24, 48, 36, 64, 52] }, { name: '写入', values: [12, 18, 16, 24, 20] }], unit: '千次', description: '各系列从零独立填充，面积不堆叠。', source },
  { kind: 'pie', title: '缺陷类型组成', labels: ['行失效', '列失效', '离散失效', '其他'], series: [{ name: '失效数', values: [42, 28, 23, 7] }], unit: '个', source },
  { kind: 'scatter', title: '温度与失效数', xLabel: '测试温度', xUnit: '℃', yLabel: '失效数', unit: '个', series: [{ name: '批次 A', points: [{ x: 25, y: 4, label: '室温' }, { x: 40, y: 7 }, { x: 85, y: 19 }] }, { name: '批次 B', points: [{ x: 25, y: 3 }, { x: 50, y: 9 }, { x: 85, y: 16 }] }], description: 'X 轴按真实数值间隔排列。', source },
  { kind: 'heatmap', title: '阵列失效分布', xLabel: '列分区', yLabel: '行分区', unit: '个', xLabels: ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'], yLabels: ['R0', 'R1', 'R2', 'R3'], values: [[0, 2, 4, 6, 2, 0], [1, 5, 15, 21, 8, 2], [0, 3, 12, 17, null, 1], [0, 0, 2, 4, 1, 0]], source },
];

// Use the actual tool-result envelope and reply renderer in the manual gallery.
const messages: ReplyMessage[] = examples.map((chart, index) => ({
  id: `chart-demo-${index}`, role: 'assistant', text: '', files: [], runId: `chart-demo-run-${index}`, createdAt: 0,
  toolCalls: [{ id: `chart-demo-tool-${index}`, name: Object.entries(chartTools).find(([, tool]) => tool.kind === chart.kind)![0], status: 'completed', text: encodeChart(chart) }],
}));

export function ChartDemo() {
  const [theme, setTheme] = useTheme();
  return <main className="pixel-chart-demo">
    <header><h1>像素图表工具演示</h1><a href={window.location.pathname}>返回工作台</a></header>
    <p>以下均为固定演示数据，不调用模型或后端接口。真实会话中由 Pi 工具返回图表。</p>
    <label>主题 <select value={theme} onChange={event => setTheme(event.target.value as ThemePreference)}><option value="system">跟随系统</option><option value="light">亮色</option><option value="dark">暗色</option></select></label>
    {messages.map(message => <StreamingReply key={message.id} message={message} pending={false} />)}
  </main>;
}
