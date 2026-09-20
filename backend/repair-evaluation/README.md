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

## 首个 device：整行 + 按列地址分组的整列修补

`spare_rows` 是每个样本可用的备用行总数。`spare_cols_per_group[g]` 是第 g 组的备用列数，组编号从 0 开始；必须逐组明确，不能把总备用列数默认当作每组数量。

一个备用行可以覆盖该行全部坏点；一个备用列可以覆盖该列全部坏点。一列无论有几个坏点，都只消耗一个对应组的备用列。只有覆盖到坏点的行列需要建立候选。行列可混合修补，组间不借用资源。没有 ECC、bank 或 segment 的隐含假设。

```python
group = (zero_based_col + column_group_offset) % column_groups
```

因此 `column_groups=8, column_group_offset=0` 对应零基坐标的 `col % 8`。CSV 若使用 1-based 地址，读取时先减 1；如果用户的模规则应直接基于原始 1-based 地址，则明确配置 `column_group_offset=1`。偏移必须小于组数。不要混淆输入基准与物理分组规则。

例如每组一条备用列时，列 0 和 8 的修补会竞争第 0 组；其它组的空余列不能代替。如果坏点恰好同属一行，也可以通过一条备用行覆盖它们。

## 数据契约

Python >=3.10。核心输入是 UTF-8 CSV，可带 BOM。路径相对于实验 JSON 所在目录，也可用绝对路径。列名通过配置映射，额外列忽略，映射字段不允许缺失。

- 名册必含 `group,sample_id`。可选 `fail_count`：若配置该映射，必须每行都有非负整数，并与原始坐标条数严格一致。没有计数列时从 `roster_columns` 删除该映射，不能填假值。
- 坏点表必含 `group,sample_id,row,col`，可以选择多个文件；这些文件作为同一输入集联合校验。`group` 是数据分组标签，**不是**备用列的资源组编号。
- 名册键 `(group,sample_id)` 唯一，并含零失效样本。样本 ID 按字符串处理，`01` 与 `1` 不自动合并。
- 坏点必须存在于名册；同一样本的坐标跨文件也不能重复。重复坐标、越界、空值、非整数、计数不匹配直接报错，不静默去重、舍弃或改写。
- 当前标准输入所有样本共用一个阵列尺寸；每条名册记录独立分配冗余。`evaluation_unit=device` 只是用户声明该条目是一颗器件，框架不会自动识别或合并重复测试。同一芯片的多次测试必须先依据任务聚合为器件坏点集合，再评估永久修补。
- 名册声明某样本存在但坏点表没有其记录时，按稀疏数据约定视为零失效；框架无法识别遗漏的上传文件。必须在计划阶段核对选取的文件及预期计数，不能只靠缺少坏点记录证明原始数据完整。

选择数据、`data_kind`（`measured`/`synthetic`）、评估单位、阵列尺寸、资源数量与规则必须来自本次用户指示或已确认信息。`experiment.example.json` 只说明格式，路径故意不可直接运行，不包含模拟数据或预计算良率。

## 准备计划并执行

在当前会话的 `$PIXEL_REPAIR_DIR` 中工作；独立使用时也可复制整个目录。先复制 `experiment.example.json` 为 `experiment.json` 并按实际任务填写，修改 `device.py` 以匹配器件。以下计划步骤只读原始数据，不调用 HiGHS，不需要安装依赖：

```bash
cd "$PIXEL_REPAIR_DIR"
python3 run.py plan --config experiment.json --out plan-001.json
```

输出包括数据路径、SHA-256、样本数、初始良品数、资源配置和规则说明。agent 必须与用户已确认的条件核对；若用户尚未提供关键条件，先询问。计划是可审阅的快照，不是授权凭证；框架校验文件一致性，用户确认由对话流程负责。

配置、device、框架或数据变化后，重新生成新的计划。不得用旧计划执行新规则。已明确授权的相同条件无需反复确认。首次执行的 Python 环境准备：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python run.py run --plan plan-001.json \
  --out "$PIXEL_WORK_DIR/artifacts/repair-001"
```

`plan` 和 `run` 可用不同 Python 环境，但要求代码与数据保持不变。`--out` 必须是不存在的新目录，不能覆盖旧实验。每个样本有独立求解时限，整个批次仍受服务 `PIXEL_RUN_TIMEOUT_SECONDS` 限制。大量样本应事先安排任务规模，超时不会自动生成完整实验结论。

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

`Action(id, covers, uses)` 表示一个二元决策。`covers` 是该动作能覆盖的当前样本坏点集合（`frozenset`）；`uses` 是各资源池消耗量，如 `{"bank0_rows": 1, "shared_fuses": 1}`。`RepairModel.capacities` 定义各池上限；一个动作可以同时消耗多个池。

`LinearRule` 可表达额外限制，例如同一物理资源两种配置只能选一种：

```python
LinearRule("exclusive", {"option_a": 1, "option_b": 1}, upper=1)
```

改成局部列段修补时，动作的覆盖范围必须限制到该段，不能继续覆盖整列；跨 bank 共享池必须把相关 bank 纳入同一个求解样本。框架固定每个名册样本独立求解，不支持单靠 device 在多个样本间共享资源。ECC、跨样本耦合或非线性约束不是当前 device 已实现的功能；需要相应建模扩展后才能报告它们的良率。

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

可由用户手动核对：零失效样本；零冗余的坏点样本；同一行多个坏点用一条备用行；同一列多个坏点只消耗一条备用列；列 0/8 竞争模 8 的同组资源；其它组有空余也不能跨组借用；行列混合救回；1-based 坐标与分组偏移；重复坐标/遗漏样本/计数不符拒绝；修改 device 后旧计划拒绝；时限未判定计入上下界；样本数不同的分组按样本加权。
