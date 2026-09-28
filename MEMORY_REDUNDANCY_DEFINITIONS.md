# Region / Segment / CCR 架构定义

本项目已确认：smart-eval 的 bank 对应这里的 region；bigSection 统一改称 segment；仅支持 CCR。segment 保留 smart-eval 的 section/subsection 行地址映射。

## 数据层级与修复范围

```text
产品
└─ Wafer
   └─ Chip
      └─ Region（即 bank，独立修复单元）
         ├─ 全局备用 row 池（默认128，全部 segment 共用）
         └─ 多个 Segment
            └─ 独立的 CCR 子组和备用 col 容量
```

用户确认的 DEJOA 数据结构：每片 wafer 1000 个 chip，每个 chip 16 个 region，每个 region 为 **32768 行 × 2048 列**。

| 名称 | 定义 |
| --- | --- |
| Region | 一套独立的行列地址空间，包含多个 segment，对应 smart-eval 的 bank |
| Segment | region 内的 row 范围和局部 CCR col 冗余资源单元，对应原 bigSection |
| 全局备用 row 池 | 每个 region 默认128条，全体 segment 共用；一次 row 修复覆盖 region 内一条原始 row 的所有 col，消耗1条备用 row |
| CCR 子组 | 每个 segment 内按原始零基列地址取模得到的资源组 |
| CCR 列备用 | 一条资源修复一个 segment 内的一条原始列；同一列跨 segment 时分别消耗资源 |
| 每子组容量 | 每个 segment 独立拥有相同的各子组容量配置，不能把它误作整个 region 的总数 |

备用 row 在一个 region 的所有 segment 间共享，不跨 region 共享。CCR 备用 col 不跨 segment、region 或子组借用。列地址不做折叠。

## Segment 行地址映射

保留原算法，只重命名 bigSection 与 colseg 的对外术语。先把输入地址归一化为 0-based，再使用整数除法：

```python
section_group = row // section_group_size
subsection = (row % section_group_size) // subsection_size \
             + section_group * subsections_per_group
segment = subsection // sections_per_segment
```

| 参数 | 含义 |
| --- | --- |
| `section_count` | 一个 region 的 section 总数 |
| `sections_per_segment` | 每个 segment 包含的 section 数，对应原 `colseg` |
| `section_group_size` | 一个 section group 的行地址跨度 |
| `subsection_size` | section group 内划分 subsection 的行地址步长 |
| `subsections_per_group` | 相邻 section group 的 subsection 编号步长 |

由配置派生：

```text
segment 数 = section_count / sections_per_segment
region 行数 = (section_count / subsections_per_group) * section_group_size
```

必须满足：

- 所有划分参数为正整数。
- `section_count` 分别能被 `subsections_per_group` 和 `sections_per_segment` 整除。
- 派生的 region 行数等于实际阵列行数。
- `section_group_size <= subsection_size * subsections_per_group`，以免最后的行映射超出所分配的 section 编号。

不要求 `section_group_size` 恰好等于 `subsection_size * subsections_per_group`，也不按 region 行数简单等分 segment。

示例：`section_count=96、sections_per_segment=2、section_group_size=2048、subsection_size=344、subsections_per_group=6` 得到 **32768 行、48 个 segment**。开始三个 segment 的行范围为 `0..687`、`688..1375`、`1376..2047`，长度分别为 688、688、672；下一个 section group 从行 2048 继续。这些范围是公式推导值。

映射参考：[smart-eval RowLayout](/home/zdong/raDev/smart-eval/backend/algo/repair_core/src/region_arch.cpp:39)。

## CCR 资源映射与修复动作

```python
ccr_group = zero_based_col % ccr_groups_per_segment
pool = (region, segment, ccr_group)
column_action = (region, segment, original_col)
```

配置 `ccr_spares_per_group[g]` 是**每个 segment 的第 g 个子组容量**。不同子组可使用不同容量；这组容量在每个 segment 独立重复。

例如 8 个 CCR 子组、每组容量 2：

- 同一个 segment 内的列 0 与列 8 竞争子组 0 的容量，修复两列消耗 2 条备用。
- 相同列在两个 segment 内出现 fail，需要两个 segment 各用 1 条备用，不能一条覆盖整个 region。
- 同一原始 row 上的所有 fail，由1条全局备用 row 覆盖；所有 segment 中需要 row 修复的不同 row 地址共同消耗 region 的128条默认容量。
- 一个动作覆盖的 fail 个数不决定资源消耗；一条行或一条局部列动作都消耗相应池的 1 条容量。

```text
每 region 的 row 池数 = 1
每 region 全局备用 row 容量 = spare_rows（默认128）
每 region 的 CCR 池数 = segment 数 × 每 segment 子组数
每 region 列备用容量总和 = segment 数 × sum(各子组容量)
```

总和用于展示，实际求解仍按独立资源池约束。参考：[smart-eval CCR](/home/zdong/raDev/smart-eval/backend/algo/repair_core/device/standard_devices.cpp:172)。

## 当前配置格式

前端架构定义使用 `pixel-architecture version:2, model:"region-ccr"`。如下为配置格式示例，其中每 region 的128条全局备用 row 是用户确认的默认值；每组2条备用 col 仍为可修改示例，**不是已确认的 DEJOA col 冗余资源数量**。

```json
{
  "kind": "pixel-architecture",
  "version": 2,
  "template_id": "ccr-segmented",
  "model": "region-ccr",
  "array": {"rows": 32768, "cols": 2048, "coordinate_base": 0},
  "device": {
    "spare_rows": 128,
    "ccr_groups_per_segment": 8,
    "ccr_spares_per_group": [2, 2, 2, 2, 2, 2, 2, 2],
    "row_layout": {
      "section_count": 96,
      "sections_per_segment": 2,
      "section_group_size": 2048,
      "subsection_size": 344,
      "subsections_per_group": 6
    }
  },
  "notes": ""
}
```

前端只提供 CCR 分段和单 segment 预设；行列尺寸、region 全局备用 row、子组数与容量为常用配置，section/subsection 参数放入高级选项。参数序列化和校验见 [architectureTemplates.ts](/home/zdong/raDev/pixel_art/fronted/src/architectureTemplates.ts)。

## 执行、绘图与统计口径

- `backend/repair-evaluation/device.py` 已实现上述覆盖关系与容量约束。每个 `Sample` 是一个 region，row 池键为 `region_rows`，列池键为 `segment_{s}_ccr_{g}`。
- 只为有 fail 的行和局部列建立候选；零 fail region 仍必须出现在完整名册中。
- 实验框架的顶层格式仍为 `schema_version:1`，将所选架构的 `array/device` 放入实验配置即可；它与前端的架构版本不是同一个版本号。
- 服务为会话补齐独立的 `ccr-device-v3.py`，通过 `PIXEL_CCR_DEVICE` 和任务上下文提供路径，避免覆盖会话中用户修改过的 `device.py`。
- 使用 `run.py plan --device "$PIXEL_CCR_DEVICE" --config ... --out ...` 生成计划；`run.py run --plan ... --out ...` 从计划读取同一 device。运行仍校验代码与数据指纹并归档快照。
- 原始 `.pwafer` 按 wafer/chip/region 身份展开完整名册和 fail 坐标；不能把所有 region 的相同 row/col 合并成一个样本。
- 框架的 `repair_yield` 是 region 口径。Chip 通过必须要求其所有 region 可修复；含 unknown 时不能直接宣称 chip 不可修复。Chip/wafer 汇总由报告脚本显式完成，不能把 region 比例直接称作 chip 良率。
- 预览使用同一 segment 公式绘制实际边界，并标明 region 全局备用 row 数量及每 segment 的 CCR 子组与 col 容量。row/col 较大者横向显示（相等时横向 col）；DEJOA 为横向 row 32768、纵向 col 2048。仅转置显示，原始地址和修复资源映射不变。

本次接入的是配置、候选建模和 Agent 规则说明；尚未执行 DEJOA 的实际修补评估，不据此报告良率。
