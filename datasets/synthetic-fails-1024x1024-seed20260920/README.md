# 1024×1024 模拟失效数据

仅供流程演示与算法比较，不是实测数据，也不是经过校准的制造缺陷模型。

- 每个样本为独立的 1024×1024 阵列；坐标从 0 开始，范围 0～1023。
- 共 100 个样本，10 个零失效样本，18329 条失效坐标。
- roster.csv 是完整名册，包含零失效样本；fails.csv 仅包含失效坐标，没有列出的单元为正常单元。
- group 表示模拟分布类型，不是物理 bank 或冗余资源组。
- fail_count 为精确计数；单样本内无重复坐标，所有坐标均在范围内。
- 固定随机种子 20260920；可用 node scripts/generate-synthetic-fails.mjs <新输出目录> 复现。
- 未设置备用行列、资源共享或修补规则，未运行求解器，未预设修复率。

## 导入

同时上传 roster.csv 和 fails.csv。设置 data_kind=synthetic、rows=1024、cols=1024、坐标基准为 0。名册映射 group/sample_id/fail_count，坏点映射 group/sample_id/row/col；额外的 data_kind 列可忽略。评估前另行确认冗余配置和规则。

## 分布

| 类型 | 样本数 | 总坏点 | 每样本坏点范围 |
|---|---:|---:|---:|
| zero | 10 | 0 | 0～0 |
| random_sparse | 20 | 203 | 1～16 |
| random_dense | 10 | 794 | 38～128 |
| row_concentrated | 15 | 1878 | 69～186 |
| column_concentrated | 15 | 2103 | 65～192 |
| local_cluster | 10 | 722 | 48～113 |
| mixed | 10 | 2389 | 164～293 |
| full_row | 5 | 5120 | 1024～1024 |
| full_column | 5 | 5120 | 1024～1024 |

row_concentrated / column_concentrated 为单行/单列中的部分坏点；full_row / full_column 为完整一行/一列失效。local_cluster 分布于一个 16×16 区域内；mixed 混合行、列、局部区域及随机散点，不代表真实发生比例。
