# Pixel Chat 后端

Node.js >= 22.19，Linux 单机单实例，Fastify + SQLite WAL + Pi RPC 子进程。依赖 Pi 固定为 `@earendil-works/pi-coding-agent@0.85.1`。保留真实 coding agent 的读写、脚本、上下文压缩、重试、技能与原生会话恢复。扩展、提示模板和主题自动发现关闭；显式加载项目内的 `backend/extensions/pixel-charts.js`，提供六种只读图表工具，参数见 [图表工具说明](../PIXEL_CHART_TOOLS.md)。本版不提供需要用户提交答案的 Pi 交互式扩展 UI。

## 配置和启动

在仓库根目录执行 `npm install`；复制 `backend/.env.example` 为根目录 `.env`，复制 `backend/models.example.json` 为 `backend/models.json`，配置模型后手动执行 `npm run build`。服务启动命令为根目录 `npm start`。

模型配置的 `models` 是可公开的选择目录；`providers` 是 Pi 原生 models.json providers 配置，支持自定义 baseUrl/api/model/cost。`env` 明确列出需要传递给 Pi 的凭据环境变量。API key 环境引用使用 `$TEAM_MODEL_API_KEY`，不是裸变量名。不要提交真实 models.json 或 .env。示例中的模型价格全零仅为配置占位。每个公开模型目录项支持仅服务端可见的 `pricingKnown`，默认 false；请核实对应 providers 模型的所有单价后才设为 true。该确认随 run 保存，后续修改配置不会追溯改变旧账。仅实际 provider/model 与确认过的选择完全匹配时记录费用；否则费用为 null，不能把 Pi 默认零价格当成免费。压缩记录缺少可靠实际模型身份时费用同样保持未知。`skills` 可列管理员维护的技能目录/文件路径；相对路径从仓库根目录解析。

Pi 在 `users/<userId>/` 启动，`PI_CODING_AGENT_DIR` 指向该用户的 `.pi/agent/`。管理员模型配置以原子替换方式写入用户的 `models.json`，已有用户 `settings.json` 不覆盖。服务启动时载入模型配置；修改模型、管理员技能路径列表、凭据后重启生效。只公开 id/label/provider/model，不公开地址和密钥。

用户技能位于 `.pi/skills/`，首次使用时从 `backend/skills/data-analysis/` 补齐数据分析 skill；已有文件不覆盖。用户可以自行维护这些技能，新 run 会重新加载。Pi 使用 `--no-skills` 加显式 `--skill` 加载用户技能和管理员配置的技能目录，避免自动引入宿主机其它技能。`--no-approve --no-context-files` 关闭项目资源信任及祖先 AGENTS/CLAUDE 自动发现，不触发 RPC 无法回答的信任询问。数据分析模式会明确要求读取用户的 `data-analysis/SKILL.md`。技能内容按需读取，上传内容不视为指令。

同时补齐 `backend/skills/repair-evaluation/`；修补/良率任务由追加系统提示引导读取该 skill。每个会话从 `backend/repair-evaluation/` 补齐到 `work/repair-evaluation/`，`PIXEL_REPAIR_DIR` 指向这里，已有 device 与框架文件不覆盖。数据校验、HiGHS、规则扩展与输出见 [评估框架说明](repair-evaluation/README.md)。这是当前 Pi 的脚本工作流，不是新的交互式 UI 或常驻 Python 服务。

若模型请求需要代理，在根目录 `.env` 配置 `HTTPS_PROXY`、`NO_PROXY` 和 `NODE_USE_ENV_PROXY=1`，使用支持该开关的 Node 运行时。后端会将这些网络变量（含 HTTP/HTTPS/NO_PROXY 的小写形式）传给 Pi 子进程，不必加入模型配置的凭据 `env` 列表。Node 不会自动使用 macOS 系统代理；代理配置变更后重启后端。

首次启动前创建管理员（服务必须停止）：

```sh
# 在根目录；避免把密码放在命令行参数/历史中
read -s PIXEL_ADMIN_PASSWORD
export PIXEL_ADMIN_PASSWORD
npm run admin:create -- admin
unset PIXEL_ADMIN_PASSWORD
```

密码至少 12 字符。管理员 CLI 也支持从 stdin 第一行读取密码。密码以随机盐 scrypt 保存；登录凭据仅在数据库保存 SHA-256 摘要。管理员在应用里创建账号、重置密码、启停账号；不开放注册。重置密码撤销登录并停止任务，停用用户同样处理，最后一个启用的管理员不能停用。

`PIXEL_ORIGIN` 必须是用户访问的完整 origin，例 `https://chat.example.com`，不含末尾斜杠。浏览器所有写入请求验证 Origin。使用 HTTPS origin 时 Cookie 自动启用 Secure；HttpOnly + SameSite=Strict 始终启用。反向代理必须允许 SSE，关闭响应缓冲。开发前端需通过 Vite `/api` 代理并把 PIXEL_ORIGIN 设置为前端 origin。

## 数据与生命周期

数据库 `pixel.sqlite` 只有 Node 主服务写入，登录会话、评估任务、聊天会话、run 分离。任务表保存名称，`task_architectures` 保存多份架构定义，`task_files` 关联输入；会话通过 `task_id` 归属任务。启动迁移 v4 将未删除的旧会话各自归入同名任务，原消息、产物和原生会话路径不变。每次执行在当前 work 生成独立的 `task-context-<runId>.json`，包含任务架构、输入及同任务历史产物清单，由 Pi 读取；不共享可写 work 或 session。目录相对于 `PIXEL_DATA_DIR`：

```text
users/<userId>/                   Pi 启动目录
  uploads/                        该用户跨会话共享的原始输入
  .pi/skills/data-analysis/        该用户可维护的数据分析技能
  .pi/agent/                      用户 Pi 运行配置
  conversations/<conversationId>/
    session.jsonl                 当前会话原生历史
    work/                         当前会话脚本、中间数据
      artifacts/                  当前会话可下载产物
```

`PIXEL_USER_DIR`、`PIXEL_UPLOADS_DIR`、`PIXEL_WORK_DIR`、`PIXEL_CONVERSATION_DIR`、`PIXEL_SKILLS_DIR` 环境变量与追加系统提示明确本轮路径。Pi 的 cwd 是用户目录，执行分析时需显式切换到 `PIXEL_WORK_DIR`。不要将可变的“当前会话”状态写到用户共享文件。同用户会话可并行，原始 uploads 按约定保持不变。

上传记录归属用户（`conversationId=null`），下载和提交附件均校验 user_id。删除来源会话不删除共享上传。产物仍校验当前会话归属。文件名加入 UUID 避免同名覆盖；上传先写隐藏 `.incoming/`，完成后原子发布。共享列表会登记手动放入 uploads 的普通文件，跳过隐藏项和软链接，最多扫描 12 层子目录。直接放入的文件建议先以隐藏名称写完再重命名。HTTP 只提供 uploads 和当前会话 artifacts 内的文件，不下载原生 session、技能配置或任意 work 文件。

启动时自动迁移旧 `conversations/<id>/` 到对应用户目录，旧上传保存在 `uploads/legacy/<conversationId>/`，保留原文件 ID 和旧目录。迁移在服务单实例锁下执行，完成复制后事务更新文件表。Pi 恢复历史时会采用 session 头部 cwd，因此迁移还会备份并更新 session 头部，按字节差额同步 runs.native_start，保持历史用量边界。迁移中断可再次启动续做；目标内容冲突或软链接会停止迁移并保留原件。升级前停服备份整个数据目录；迁移后回退旧服务需要恢复匹配的数据库和目录备份。

HTTP 的归属和路径校验不等于 OS 沙箱；Pi 仍使用服务 OS 账号的文件权限。用户目录及会话目录是工作组织边界。

每个聊天会话同一时刻只能运行一个任务，跨会话可以并行。请求幂等键按用户去重；不同请求复用键返回 409。取消先发 RPC abort，超时后关闭监督进程组；进程监督器也在主服务 IPC 断开时清理 Pi 与追踪到的 Linux detached shell 子进程。任务终态在清理与会话同步后提交，agent_settled 才表示 Pi 含重试/压缩在内的真正空闲。

Linux 使用内核 abstract Unix socket 单实例锁，崩溃自动释放；启动等待监督器清理后把活动任务标为 interrupted，绝不重放脚本。macOS 开发使用 PID 文件锁；崩溃遗留锁需要确认服务已停止后手动删除 `<data>/server.lock`。不要使用共享网络文件系统或复制相同数据目录给多个实例。

消息、事件先落库后推送；SSE event 为 `run`，payload 见 `@pixel/contracts`，支持 `Last-Event-ID` 和 `after`。SSE 断开不取消任务，慢客户端通过数据库游标回放并遵守写入背压。每 15 秒复查登录有效性。聊天软删除前取消执行，用量记录保留；文件物理清理暂不自动执行。

Pi 0.85 的 `message_update` 不包含完整 `message`；后端从 `message_start` 建立当前消息，按 `contentIndex` 拼接文字增量并即时推送 `text.delta`，最后以 `message_end` 校准。工具事件关联所属消息，会话快照从持久事件恢复工具状态。前端将一次 run 的模型轮次合成一条持续更新的回复，工具调用内联显示，不为仅调用工具的轮次生成空白回复。

思考文本通过 `reasoning.delta` 传递，模型调用统计随文本/思考增量或 `generation.updated` 更新，并写入启动时自动创建的 `message_details` 表。只传递模型提供的可读 thinking 内容，不传递签名或已标记 redacted 的最终内容。回复速度为各轮输出 token 总数 / 各轮模型调用耗时总和（包含首 token 等待，排除工具执行时间）；未获得非零模型用量时按 ASCII 约四字符/token、其他字符约一字符/token 估算并显式标注。最终以模型返回用量校准，重启恢复使用原生记录时间，不使用重启时间。工具事件保存调用参数、累计文本输出及执行耗时；参数和输出分别限制为 64000 字符，超出会显示截断提示。前端提供默认收起的工具和思考详情，缺失历史输出时明确提示。

用量以原生条目 ID 去重，从 native_start 字节边界划分 run；模型调用、工具调用、压缩汇总、无法确认的重试分别标明粒度。重启按原生会话补账。失败/取消且 Pi 给出全零占位时记录未知，不当作零消耗。每次 assistant 调用跟踪到原生记录；即使前面的调用已有用量，最后一次调用未能持久化仍单独增加未知记录。正常关闭服务先发 RPC abort，等待配置的取消时限，再清理进程并保存 interrupted 终态。Pi 不提供的失败重试/压缩细分数据无法还原，账本不会声称精确。成本为配置模型单价得到的 USD 估算，不是供应商账单。没有余额、扣费或用量配额。

## 运维与验收

只支持单机内部可信团队。Pi 与服务使用同一 OS 账号，可执行脚本、访问账号有权限的文件与网络；不要将它作为不可信多租户沙箱。工具不能启动长期后台服务或故意脱离进程树；监督器不等同容器隔离。需要隔离时另增 OS 用户/容器边界。

生产使用独立服务账号、反向代理 HTTPS、绝对 PIXEL_DATA_DIR。备份时停止服务并整体复制数据目录（数据库、WAL/SHM、原生会话和文件必须一致）；不要只复制正在写入的 sqlite 文件。恢复时同样停服整体恢复。

接口与手动验收场景见根目录 contracts README 和 MANUAL_CHECKS.md。遵循项目约定，本次未运行测试、构建、类型检查或浏览器自动验收；需用户手动验证。

## 架构预览 Harness

Agent 读取每轮任务上下文中的架构 ID 与指纹，自行编写浏览器执行的 `draw.mjs` 及元数据生成脚本；`PIXEL_ARCHITECTURE_HARNESS` 指向校验/归档命令，`PIXEL_NODE` 指向执行它的 Node，`PIXEL_TASK_CONTEXT` 指向本轮资料。前端注入 Pixi、可缩放的默认网格、视野与主题颜色，实时执行 `draw(ctx)`。真实阵列尺寸与显示视口分开，支持大阵列按视野绘制。Harness 检查元数据与颜色引用，保留函数源码、脚本、SHA256、主题颜色快照及各次发布版本。后端再次校验文件归属和完整性；这些检查不证明器件语义正确。流程与 draw 接口见 [README](architecture-preview/README.md)。
