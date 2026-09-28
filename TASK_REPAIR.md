# 批量 C++ 修补任务

任务导航增加“任务求解”。先在“架构”保存定义，在“数据”登记并关联 wafer，再选择多份架构、多片 wafer 和编码引擎，查看组合后点击“添加并运行”。目前一份数据集对应一片已登记的 `.pwafer`；例如 2 个架构和 3 片 wafer 生成 6 项。单批最多 100 项，每个用户最多 200 项待完成任务。

服务需要可用的 Pi 模型配置及支持 C++17 的 `g++`。部署时使用原有根目录 `npm run build` 和启动流程，保留 `backend/repair-cpp/` 以及 `scripts/repair-supervisor.mjs`；求解器在点击运行后按任务编译。源代码实现已接入，本次未执行构建、编译、实际模型调用或浏览器验收。

## 执行过程

1. 提交时冻结架构名称、定义、指纹、wafer 元数据和文件 SHA-256。批量添加是一个事务；同一请求标识不会重复入队。
2. 后端用所选引擎创建独立的编码聊天，提供架构快照和 C++ 契约。Agent 只实现 `dev.hpp`，负责校验架构参数、生成资源池和修补候选，不执行编译或求解。同批次同一架构复用一次生成结果。
3. 后端复制可信 `main.cpp`、`model.hpp`、`repair_most.hpp`，加入生成的 `dev.hpp` 和输入快照，调用 `g++`。编译参数固定；编译失败在任务中显示错误，日志可下载。
4. C++ 对非空 region 独立执行 repairMost，每步选择预算允许且覆盖最多未覆盖 fail 的动作，同分按动作 ID 排序。结束后重新计算覆盖与资源用量，核对生成的方案。
5. 后端检查 C++ 退出码、JSONL 进度、完整数据分母、原始良品计数、良率公式、磁盘结果与 stdout 摘要、输入与代码指纹。全部通过才发布完成状态和良率。

当前是单个后台求解队列，限制同时编码、编译和求解的数量。可以逐项取消；服务重启将未完成任务标为“中断”，不会自动重跑或重复调用模型。关闭或重置账号会停止相关任务。取消编码中的一项后，同架构剩余任务需要重新编码；已完成的代码可以复用。

## dev.hpp 与架构约束

模板及函数契约见 [C++ README](backend/repair-cpp/README.md) 和 [dev.hpp](backend/repair-cpp/dev.hpp)。仓库的 `dev.hpp` 是显式报错的占位模板，不能直接拿默认参数计算。每批 Agent 写的是其编码会话 `work/repair-codegen/dev.hpp`，后端再将其冻结到求解目录，不覆盖仓库模板。

Agent 必须实现 `dev::validate_layout(rows, cols)` 与 `dev::build_model(region)`。输入全部为零基坐标。通用模型表达动作对一个或多个资源池的非负消耗与容量上界；不能表达的规则必须报错。核心检查模型的索引、重复、覆盖和预算，不自动证明 Agent 的映射符合物理器件；生成代码和规则需要按架构核对。

CCR 遵循 [已确认的架构定义](MEMORY_REDUNDANCY_DEFINITIONS.md)：一个 region 共享一个全局 row 池，列池按 `(segment, col % groups)` 独立；不能跨 region、segment 或子组借用列容量。segment 必须使用 section/subsection 公式，不按行数平均切分。所有资源数量取提交的架构快照。

## 良率口径与产物

- Region 良率 =（原始零 fail region + 找到完整修补方案的 region）/ 完整 region 数。
- Wafer 的 chip 良率 = 所有 region 都通过的 chip 数 / 该 wafer 完整 chip 数。
- `heuristic_unresolved` 表示 repairMost 未修成，不证明无解；这些比例是本启发式找到方案的通过率。合成 wafer 会持续标注，不代表真实量产良率。
- 缺席的稀疏 region 表示零 fail，仍计入完整分母；逐 region JSONL 仅列非空 region，末尾包含完整汇总。

每项执行快照保存在 `PIXEL_DATA_DIR/users/<userId>/repair-jobs/<jobId>/`，包括 wafer、规范整数输入、核心源码、`dev.hpp`、编译文件、日志和结果。界面提供 `dev.hpp`、`manifest.json`、`compile.log`、`result.jsonl` 下载；早期失败或取消可能尚未生成对应文件。任务面板保留架构指纹和时间，架构修改后旧结果继续对应旧快照。

编译上限 60 秒，求解上限 10 分钟；日志、输出和模型规模有限制，Linux 安装 `prlimit` 时应用 CPU、地址空间与文件大小限制。进程监督器监控服务 IPC，服务退出时清理执行组。这些控制沿用项目的可信团队部署边界，具体说明见 [执行边界](backend/repair-cpp/EXECUTION.md)。

## 手动验收建议

从 2 个尺寸匹配架构 × 2 片小 wafer 开始，确认 4 项入队，同一架构使用同一次编码聊天。再查看全零 wafer、零容量且含 fail、恰好用完资源、CCR 不同 segment 同列、尺寸不匹配和服务中断后的状态。全零输入也必须通过架构校验；错误与中断不能发布良率。核对下载的代码、规则及逐 region 方案后，再使用大 wafer。
