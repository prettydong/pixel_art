# Pixel Chat

面向内部团队的像素聊天工作台。React + TypeScript 前端，Fastify + SQLite 后端，完整 Pi coding agent 通过 RPC 子进程执行。Linux 直接部署，不需要 Docker、Redis 或单独的数据库服务。

## 首次启动

使用 Node.js 24（最低 22.19）和 npm。以下命令在项目根目录执行：

```bash
npm ci
cp backend/.env.example .env
cp backend/models.example.json backend/models.json
```

编辑 `.env` 中的模型凭据，以及 `backend/models.json` 中的模型和服务地址。实际凭据不要提交到仓库。模型配置的 `env` 列表明确指定哪些环境变量可以传给 pi；模型列表接口不会返回凭据。价格默认未知；只有确认模型单价后才将该模型的 `pricingKnown` 设为 `true`。内置模型与自定义兼容接口的配置见 [后端说明](backend/README.md)。

```bash
npm run build
read -r -s PIXEL_ADMIN_PASSWORD
export PIXEL_ADMIN_PASSWORD
npm run admin:create -- admin
unset PIXEL_ADMIN_PASSWORD
```

管理员初始化命令在服务停止时执行，通过环境变量 `PIXEL_ADMIN_PASSWORD` 或标准输入读取密码（至少 12 字符），不会生成默认密码。交互式终端请按命令提示以隐藏输入设置临时环境变量，完成后清除。随后：

```bash
npm start
```

默认地址是 http://localhost:3000，后端同时提供构建后的前端。Linux 和 macOS 上应分别安装依赖，不要直接复制跨平台 `node_modules`；SQLite 驱动包含本机原生组件。

## 开发

```bash
npm run build -w @pixel/contracts
PIXEL_ORIGIN=http://localhost:5173 npm run dev:backend
```

另一个终端运行：

```bash
npm run dev:fronted
```

前端默认 http://localhost:5173，通过 Vite 代理访问后端。`PIXEL_ORIGIN` 必须与浏览器地址的协议、主机名和端口完全一致，写入接口会检查来源。修改共享契约后重新构建 contracts。

## 功能与边界

前端消息支持 GFM Markdown；单选、多选、确认/取消和表单的本地演示入口为 `?demo=tools`，也可从登录页或模型菜单打开。该入口不调用后端，历史独立保存在浏览器。组件接口、演示流程与手动验收见 [前端工具说明](FRONTEND_TOOLS.md)。

- 管理员创建、重置、启停账号；用户登录、改密和退出。登录会话、聊天会话、执行任务分别管理。
- 左侧按任务名组织，每个任务依次包含架构、数据、执行结论和多个聊天。可新建、重命名任务；点击聊天标题可重命名或移动到其他任务。无产物时执行结论置灰。
- 会话和消息保存到服务器，支持搜索、重命名、删除、Markdown 导出；浏览器旧演示历史保持原样，不自动上传。
- 管理员统一配置模型；同一用户的多个会话可以并行。同一会话仅一个活动任务，重复提交通过幂等键去重。
- SSE 推送文本与工具状态，断线后可重连；刷新页面不停止后台任务。停止任务会先请求 pi 取消，再清理进程及脚本。
- 附件上传到 `data/users/<userId>/uploads/`，在同一用户的会话间共享。Pi 从用户目录启动，使用自己的 `.pi/skills/`；每个会话的 `conversations/<id>/work/` 保存脚本和中间文件，`work/artifacts/` 保存可下载产物。上传可在任务的数据页添加，也可从已有上传中关联；同一任务的聊天共享资料清单。
- 用量按用户、会话、任务、模型、时间记录；包括可获得的模型调用、工具调用与压缩信息，支持筛选和分页。费用是估算，缺失数据标为未知。不设置用户额度、不做付费扣费。
- Pi 原生会话文件用于恢复上下文，数据库消息用于展示。中断任务不会自动重放；重启后对原生记录补齐统计，来源 ID 防止重复累计。

Pi 固定版本为 `@earendil-works/pi-coding-agent@0.85.1`，RPC 适配封装在后端，前端只使用共享业务契约。内置六种像素图表工具已通过显式 Pi 扩展接入，支持柱状图、折线图、面积图、饼图、散点图和热力图；[工具说明与参数](PIXEL_CHART_TOOLS.md)，本地演示入口 `?demo=charts`。完整脚本能力需要服务器安装相应工具，如 bash、Python 或业务计算程序；TypeScript 后端本身不替代这些工具。

独立进程、独立目录不构成操作系统沙箱。本版面向可信内部用户，同一 OS 服务账号下的 agent 仍具有该账号的文件和网络权限。工具不应启动长期后台服务。HTTP 的身份、路径及符号链接校验保护文件接口，但不会限制 agent 脚本本身。

## 任务资料

架构页可保存多个命名架构定义，点击“让 Agent 绘制预览”会由 Agent 编写实际执行的 `draw(ctx)` 模块及场景 JSON，经 Harness 归档后由前端 Pixi 执行。默认网格支持 1024×8192 等真实阵列尺寸，按视野裁剪和缩放合并格线；支持全图、缩放、拖动、单元格与行列定位。画布、区域坐标、分割线宽度/颜色、字体、主题颜色快照与架构指纹均保存；支持重新生成和查看历史版本，架构修改后旧图不再作为当前预览。约定见 [架构预览 Harness](backend/architecture-preview/README.md)。

架构页同时列出评估框架 `sources/00_experiment.json` 中的已执行架构快照；历史快照只读。数据页关联本任务输入，结论页汇总各聊天的报告和可下载产物。文件物理位置和每个聊天的 Pi 会话保持独立，新的 run 会收到任务资料快照，避免并发聊天互相覆盖工作文件。

升级后，服务启动时将未删除的旧会话各自归入同名任务，并关联历史消息实际使用的上传；需要合并时通过聊天标题的“所属任务”移动。`?demo=tools` 仍是原有独立本地演示，不使用服务端任务管理。

## 修补与良率评估

内置 [HiGHS 评估框架与 device](backend/repair-evaluation/README.md)。Agent 先明确使用的数据、完整样本名册、冗余数量和修补规则，再修改当前会话的 `device.py`，通过 `plan` / `run` 执行实验。初始 device 支持备用整行和按 `col % N` 分组的备用整列；组数及每组容量可配置，非默认结构由 agent 根据任务修改。框架保留逐样本方案、良率、未判定上下界和代码/输入指纹。每个会话持有独立副本，已有修改不覆盖；Python 与 highspy 依赖按框架说明准备。

## 部署与备份

- 用 `PIXEL_DATA_DIR` 指定发布目录之外的持久化数据目录；运行账号需要读写权限。
- 只启动一个主服务实例。Linux 使用进程间锁保护同一数据目录，防止重复启动。
- 对外部署使用同源 HTTPS 反向代理，并将 `PIXEL_ORIGIN` 设为实际地址。代理需要关闭 SSE 响应缓冲并允许长连接。
- 可选 systemd 单元见 [deploy/pixel-chat.service](deploy/pixel-chat.service)。调整 Node 路径、工作目录和环境文件后安装；它会在服务停止时清理整个服务的子进程。
- 停止服务后备份整个数据目录，包括 SQLite、会话原始文件、附件和产物；模型配置另行备份，凭据另行保管。不能只复制运行中的 SQLite 主文件而忽略 WAL。
- 本版软删除会话，保留原生数据和用量。磁盘容量由管理员维护；没有后台数据清除任务。

## 目录与协作

保留 `fronted/`、`backend/`；`packages/contracts/` 存放类型、请求校验和事件示例。协议见 [契约说明](packages/contracts/README.md)，部署配置详见 [后端说明](backend/README.md)。

本次实现按项目约定未运行测试、构建或浏览器自动验收。请按 [手动验收清单](MANUAL_CHECKS.md) 验证真实模型、并发、取消、重连和恢复行为。

## 像素网格与外观

`fronted/src/pixelGrid.ts` 在首次渲染及屏幕、窗口、DPR 变化时计算网格：一个设计像素对应 3×3 个设备像素，CSS 基础单位为 `3 / devicePixelRatio`。正文统一 Fusion Pixel 12px、字号 12 格；图标为 16×16 整数方格 SVG。默认跟随系统，也可切换亮色、暗色，选择保存在当前浏览器。

这是固定设备像素比例，不是固定视觉字号；系统额外缩放仍可能影响显示。字体来源 [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)，许可保存在 `fronted/public/fonts/licenses/12/`。具体设计约定见 [AGENTS.md](AGENTS.md)。
