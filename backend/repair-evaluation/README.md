# HiGHS 修补评估框架

框架负责输入校验、逐样本求解、方案复核与良率汇总；agent 负责理解输入和器件结构，并修改 `device.py`。不把某种冗余结构写死在求解器中。当前为 CLI + Pi skill 接入，不增加前端专用页面。

每个聊天会话会得到 `work/repair-evaluation/` 下的独立代码副本；已有文件不覆盖，用户修改可跨轮次继续使用。环境变量 `PIXEL_REPAIR_DIR` 指向该副本。不要修改仓库模板来运行某个用户的单次实验。后续框架升级需要显式迁移已有副本，不能把“补齐缺失文件”当成完整版本升级。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `models.py` | `Sample`、`Action`、`LinearRule`、`RepairModel` 契约 |
| `data.py` | CSV、完整名册、范围、重复记录、预期计数、文件指纹校验 |
| `framework.py` | HiGHS 二元覆盖模型、修补方案复核、良率口径 |
| `device.py` | 可修改的器件结构、参数校验、规则说明与修补候选 |
| `run.py` | `plan` / `run` 两阶段执行、快照和结果输出 |
| `experiment.example.json` | 示例配置；其中数值不是用户默认配置 |

## CCR device：region 全局 row 与 segment 局部 col

本模型中一个框架 `sample` 就是一个 **region**（原 smart-eval 的 bank）。`spare_rows` 是该 region 的全局备用 row 容量，默认128，池键为 `region_rows`；全部 segment 共用此池，一条动作覆盖 region 内一条原始 row 的所有 fail，消耗 1 条备用 row。不同 region 不共享此池。`repair_yield` 因而是 region 口径。要计算 chip 良率，必须在外部确认其所属所有 region 都可修复后再汇总，不能把 region yield 直接称为 chip yield。

CCR 列资源按 segment 独立重复：`ccr_groups_per_segment` 是每个 segment 的组数，`ccr_spares_per_group[g]` 是该 segment 第 g 组的容量。对于一个 fail `(row, col)`，先按保留的 smart-eval section/subsection 映射得到 segment：

```python
section_group = row // section_group_size
subsection = (row % section_group_size) // subsection_size \
             + section_group * subsections_per_group
segment = subsection // sections_per_segment
group = col % ccr_groups_per_segment
```

一个 CCR 动作对应 `(segment, original_col)`，覆盖该 segment 内该**原始列地址**的全部 fail，并消耗 `segment_{segment}_ccr_{group}` 一条容量。列地址不折叠、不偏移；容量不能跨 group 或跨 segment 借用。每个 region 建立一个全局 row 池，仅为有 fail 的 `(segment, group)` 建立 col 池；候选仅包含有 fail 的原始行列，因此空 region 合法而不会枚举完整矩阵。模型不支持 LCR、ECC 或跨 region 共享资源。

`row_layout` 要求 `section_count` 必须分别被 `subsections_per_group` 和 `sections_per_segment` 整除，并且 `section_group_size <= subsection_size * subsections_per_group`。推导出的行数为：

```python
expected_rows = (section_count // subsections_per_group) * section_group_size
segment_count = section_count // sections_per_segment
```

`experiment.example.json` 使用 DEJOA 的 `32768 × 2048` 尺寸，以及用户确认的每 region 默认128条全局备用 row。每组2条 CCR 备用 col 仍为示例，并非已确认的量产 col 资源配置。它含 96 sections、每 segment 2 sections，因此有 48 个 segment；`2048 <= 344 * 6` 合法。实验文件仍使用框架 `schema_version: 1`；前端 pixel-architecture JSON 的 `version: 2, model: "region-ccr"` 是另一份配置契约，不能替代本实验输入。

## 数据契约

Python >=3.10。核心输入是 UTF-8 CSV，可带 BOM。路径相对于实验 JSON 所在目录，也可用绝对路径。列名通过配置映射，额外列忽略，映射字段不允许缺失。

- 名册必含 `group,sample_id`。可选 `fail_count`：若配置该映射，必须每行都有非负整数，并与原始坐标条数严格一致。没有计数列时从 `roster_columns` 删除该映射，不能填假值。
- 坏点表必含 `group,sample_id,row,col`，可以选择多个文件；这些文件作为同一输入集联合校验。`group` 是数据分组标签，**不是**备用列的资源组编号。
- 名册键 `(group,sample_id)` 唯一，并含零失效样本。样本 ID 按字符串处理，`01` 与 `1` 不自动合并。
- 坏点必须存在于名册；同一样本的坐标跨文件也不能重复。重复坐标、越界、空值、非整数、计数不匹配直接报错，不静默去重、舍弃或改写。
- 当前标准输入所有样本共用一个阵列尺寸；CCR device 要求其行数等于 row layout 推导的 `expected_rows`，列数为正整数。每条名册记录分配独立的 region 全局 row 池和各 segment 局部 CCR col 池。`evaluation_unit` 保持 `sample`，表示 region；框架不会自动合并同一 chip 的 regions。
- 名册声明某样本存在但坏点表没有其记录时，按稀疏数据约定视为零失效；框架无法识别遗漏的上传文件。必须在计划阶段核对选取的文件及预期计数，不能只靠缺少坏点记录证明原始数据完整。

选择数据、`data_kind`（`measured`/`synthetic`）、评估单位、阵列尺寸、资源数量与规则必须来自本次用户指示或已确认信息。`experiment.example.json` 只说明格式，路径故意不可直接运行，不包含模拟数据或预计算良率。

## 准备计划并执行

在当前会话的 `$PIXEL_REPAIR_DIR` 中工作；独立使用时也可复制整个目录。先复制 `experiment.example.json` 为 `experiment.json` 并按实际任务填写，核对所选 CCR device 与器件配置。服务会向会话补齐 `ccr-device-v3.py`；独立复制仓库框架时，可将下方 `--device` 改为 `device.py`。以下计划步骤只读原始数据，不调用 HiGHS，不需要安装依赖：

```bash
cd "$PIXEL_REPAIR_DIR"
python3 run.py plan --config experiment.json --device ccr-device-v3.py --out plan-001.json
```

输出包括数据路径、SHA-256、样本数、初始良品数、资源配置和规则说明。agent 必须与用户已确认的条件核对；若用户尚未提供关键条件，先询问。计划是可审阅的快照，不是授权凭证；框架校验文件一致性，用户确认由对话流程负责。

配置、device、框架或数据变化后，重新生成新的计划。不得用旧计划执行新规则。已明确授权的相同条件无需反复确认。首次执行的 Python 环境准备：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python run.py run --plan plan-001.json \
  --out "$PIXEL_WORK_DIR/artifacts/repair-001"
```

`--device` 指向会话目录中本次规则的 `ccr-device-v3.py`；计划会记录其指纹，`run` 保存同一文件的快照并拒绝计划后改动。`plan` 和 `run` 可用不同 Python 环境，但要求代码与数据保持不变。`--out` 必须是不存在的新目录，不能覆盖旧实验。每个样本有独立求解时限，整个批次仍受服务 `PIXEL_RUN_TIMEOUT_SECONDS` 限制。大量样本应事先安排任务规模，超时不会自动生成完整实验结论。

`run` 使用 [HiGHS 官方 Python 接口](https://ergo-code.github.io/HiGHS/stable/interfaces/python/)，依赖固定为 `highspy==1.13.1`；实际 HiGHS 与 Python 版本写入运行记录。没有全局 Python 安装副作用。

## 修改 device 的接口

device 是受信任的 Python 代码，不是沙箱。保持单文件，除标准库及 `models` 外不要依赖未记录的本地辅助代码；如需拆分，先扩展运行器的源代码快照清单。不要在导入或 `describe()` 中执行实验、读写输入、随机造数。

```python
DEVICE_API_VERSION = 1

def validate_config(config: dict) -> None:
    # 校验当前结构参数，拒绝未知或遗漏的字段。
    ...

def describe(config: dict) -> dict:
    # 返回与实现一致、可供用户确认的 JSON 规则说明。
    ...

def build_model(sample: Sample, config: dict) -> RepairModel:
    # 生成全部合法修补候选和约束，不调用求解器、不改 sample.fails。
    ...
```

`Action(id, covers, uses)` 表示一个二元决策。`covers` 是该动作能覆盖的当前样本坏点集合（`frozenset`）；`uses` 是各资源池消耗量，如 `{"region_rows": 1}`。`RepairModel.capacities` 定义各池上限；一个动作可以同时消耗多个池。

`LinearRule` 可表达额外限制，例如同一物理资源两种配置只能选一种：

```python
LinearRule("exclusive", {"option_a": 1, "option_b": 1}, upper=1)
```

当前 CCR device 的 row 动作共用 region 全局池，col 动作消耗所属 segment 和子组的局部资源。框架固定每个 region 样本独立求解，row 不跨 region 共享，col 不跨 region、segment 或子组借用；ECC、跨 region 耦合和非线性约束不属于当前模型。

求解器对每个候选建立二元变量 `x[a]`：

- 每个坏点：覆盖该点的所有 `x[a]` 之和 ≥ 1。
- 每个资源池：所有动作消耗量乘 `x[a]` 的和 ≤ 可用资源数。
- 每个附加规则：线性和落在声明的上下界内。

目标为最小化动作数量以获得简洁方案；可修复性只要求找到一个完整合法方案。返回方案后框架重新以整数计算覆盖、资源用量和附加规则。此复核能查出违反所声明模型的方案，不能证明 agent 描述的规则与真实器件相符，也不能发现被漏建的合法候选。

## 状态、良率及产物

| 状态 | 判定 |
| --- | --- |
| `repairable` | 有通过独立复核的完整整数修补方案，或无变量常量模型满足所有条件 |
| `unrepairable` | HiGHS 证明不可行，或无变量常量模型明确不可行 |
| `unknown` | 如到时限且没有有效完整方案，也没有不可行证明 |

数值/求解错误使运行失败；不会为了凑分母把错误标成不可修复。到时限但已有合法方案仍可判可修复，此时不声称动作数最少。零失效样本也在名册分母中；示例 device 下可直接通过。

`repair_yield = repairable / total`，其中 repairable 包括原始零失效样本。有 unknown 时点估计为 `null`，给出 `[repairable / total, (repairable + unknown) / total]`；这是求解状态造成的范围，不是统计置信区间。`defective_repair_rate` 则以初始失效样本为分母。总体良率按所有样本加权，不平均各组百分比。

- `run.json`：运行状态、完成数量、时间、Python/HiGHS 版本。只有 `completed` 表示完整结果；进程被强制终止时可能仍为 `running`，不能当成完成。
- `plan.json`：已执行的条件、源文件路径与指纹。
- `sources/`：配置和 framework/device 代码快照，不复制用户原始数据；原始数据需另外保留。
- `results.jsonl`：逐样本状态、选中动作 ID、资源用量及求解状态；中途失败可保留部分记录。
- `samples.csv`：便于汇总的逐样本表。
- `summary.json`、`report.md`：总体、分组良率及规则说明。

## 手动核对建议

可由用户手动核对：零失效 region；零冗余的坏点 region；同一 row 多个坏点只消耗1条全局备用 row；默认128条 row 且 CCR col 容量为0时，跨任意 segment 的128个不同 row 可修复，129个不同 row 不可修复；同一 segment 的列 0/8 竞争模 8 的同组 CCR 容量；相同原始列在不同 segment 分别消耗各自容量；其它 group 或 segment 有空余 CCR col 也不能借用；行列混合救回；行数不等于 layout 推导值拒绝；重复坐标/遗漏样本/计数不符拒绝；修改 device 后旧计划拒绝；时限未判定计入上下界；样本数不同的分组按 region 加权。
