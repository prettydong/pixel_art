# Pixel Chat

A pixel-style chat workspace for internal teams. React + TypeScript frontend, Fastify + SQLite backend, and the full Pi coding agent running as an RPC subprocess. Deploy directly on Linux without Docker, Redis, or a separate database service.

## First Startup

Use Node.js 24 (minimum 22.19) and npm. Run the following commands from the project root:

```bash
npm ci
cp backend/.env.example .env
cp backend/models.example.json backend/models.json
```

Edit the model credentials in `.env`, and the models and service URLs in `backend/models.json`. Do not commit real credentials. The model configuration's `env` list explicitly specifies which environment variables may be passed to Pi; the model-list API does not return credentials. Pricing is unknown by default; set a model's `pricingKnown` to `true` only after verifying its unit prices. See the [backend documentation](backend/README.md) for built-in models and custom compatible endpoints.

```bash
npm run build
read -r -s PIXEL_ADMIN_PASSWORD
export PIXEL_ADMIN_PASSWORD
npm run admin:create -- admin
unset PIXEL_ADMIN_PASSWORD
```

Run the administrator initialization command while the service is stopped. It reads a password (at least 12 characters) from `PIXEL_ADMIN_PASSWORD` or standard input and does not generate a default password. In an interactive terminal, follow the command prompt to set a temporary environment variable using hidden input, then clear it afterward. Next:

```bash
npm start
```

The default address is http://localhost:3000; the backend also serves the built frontend. Install dependencies separately on Linux and macOS instead of copying `node_modules` across platforms; the SQLite driver includes native components.

## Development

```bash
npm run build -w @pixel/contracts
npm run dev:backend
```

In another terminal, run:

```bash
npm run dev:fronted
```

The frontend defaults to http://localhost:5173 and accesses the backend through Vite's proxy. The access URL does not have to match `PIXEL_ORIGIN` exactly; write endpoints still reject requests marked as cross-site by the browser. Rebuild contracts after changing the shared contracts.

## Features and Boundaries

The interface defaults to English. Switch to Simplified Chinese on the login page or in settings; the choice is saved in the current browser. Switching languages does not translate or rewrite existing conversations, user-defined names, or uploaded materials.

Frontend messages support GFM Markdown. The local demo for single choice, multiple choice, confirm/cancel, and forms is available at `?demo=tools`, or from the login page or model menu. It does not call the backend; its history is stored separately in the browser. See [frontend tools](FRONTEND_TOOLS.md) for component interfaces, demo flows, and manual acceptance checks.

- Administrators create, reset, enable, and disable accounts; users sign in, change passwords, and sign out. Login sessions, chat conversations, and execution tasks are managed separately.
- The left navigation is organized by task name. Each task contains architecture, data, execution conclusions, and multiple chats, in that order. Tasks can be created; the ellipsis menu beside the task title supports renaming and deletion. Confirmed deletion removes the task and its chats; active executions must be stopped first. Tasks are soft-deleted, retaining underlying records; shared products, wafers, and uploads are retained. Click a chat title to rename it or move it to another task. Execution conclusions are disabled when there are no artifacts.
- Conversations and messages are saved on the server, with search, rename, delete, and Markdown export. Old browser demo history is retained as-is and is not uploaded automatically.
- Administrators configure models centrally. Multiple conversations belonging to the same user may run concurrently. Each conversation permits only one active execution; idempotency keys deduplicate repeated submissions.
- SSE streams text and tool status and supports reconnection. Refreshing the page does not stop background tasks. Stopping a task first requests cancellation from Pi, then cleans up processes and scripts.
- Attachments are uploaded to `data/users/<userId>/uploads/` and shared across the user's conversations. Pi starts from the user directory and uses its own `.pi/skills/`. Each conversation's `conversations/<id>/work/` contains scripts and intermediate files; `work/artifacts/` contains downloadable artifacts. Add uploads on a task's data page or link existing uploads; chats in the same task share a material inventory.
- Usage is recorded by user, conversation, task, model, and time, including available model-call, tool-call, and compaction information, with filtering and pagination. Costs are estimates; missing data is marked unknown. There are no user quotas or paid billing deductions.
- Pi's native session files restore context; database messages provide the display history. Interrupted tasks are not replayed automatically. After a restart, statistics are reconciled from native records, with source IDs preventing double counting.

Pi is pinned to `@earendil-works/pi-coding-agent@0.85.1`. RPC adaptation is encapsulated in the backend; the frontend uses only shared business contracts. Six built-in pixel-chart tools are connected through an explicit Pi extension: bar, line, area, pie, scatter, and heatmap charts. See [tool documentation and parameters](PIXEL_CHART_TOOLS.md); the local demo is `?demo=charts`. Full scripting capabilities require the relevant server tools, such as bash, Python, or domain-specific computation programs; the TypeScript backend does not replace them.

Separate processes and directories do not constitute an operating-system sandbox. This version is intended for trusted internal users; agents running under the same OS service account retain its file and network permissions. Tools should not start long-lived background services. HTTP authentication, path, and symbolic-link checks protect file endpoints but do not constrain agent scripts themselves.

## Task Materials

Architecture configuration uses CCR: a region is an independent repair unit (a bank), and bigSection is consistently called segment, retaining smart-eval's section/subsection address mapping. All segments in a region share a global spare-row pool (128 rows by default). CCR spare columns are independent by segment and subgroup; column resources cannot be borrowed across segments or subgroups. Common settings configure region dimensions, global spare rows, CCR subgroup count, and per-group capacity; segment partitioning is under advanced options. See [MEMORY_REDUNDANCY_DEFINITIONS.md](MEMORY_REDUNDANCY_DEFINITIONS.md).

The data page manages wafer data as "product → wafer → chip → region". A product defines chips per wafer, regions per chip, and each region's row × col dimensions. One `.pwafer` binary file represents one wafer, using sparse regions and delta-encoded fail addresses, including zero-fail structure and CRC32 validation. Wafers from the product library can be linked to different tasks; the data page consistently uses the new format.

See [WAFER_FORMAT.md](WAFER_FORMAT.md) for the format and generation commands. The generator is `scripts/generate-wafer-fails.mjs`. `datasets/wafer-demo/` provides three reproducible synthetic samples (64 chips, 8 regions per chip, 1024 × 1024 per region, including one zero-fail wafer); these do not represent real manufacturing data.

Use **Load DEJOA demo** in the signed-in workspace to create a fresh task with three fixed synthetic wafers (200 chips × 16 regions, 32768 rows × 2048 columns) and the R128 C2 / R64 C2 / R128 C1 CCR variants. Nine combinations are prepared in the run list; nothing executes until you start Solver manually. The portable demo bundle and its generation parameters are in [backend/demos/dejoa](backend/demos/dejoa/README.md).

The page supports importing and generating wafers. After saving, it automatically previews a heatmap of the chip grid inside a disk; selecting a chip updates the region-coordinate view. Colors summarize actual fail counts, with a zero-value color, numeric legend, and linear/logarithmic scales. Generation patterns include center, edge ring, local, and scratch; parameters and seeds are saved in the wafer record. Automatic chip positions are schematic; see [WAFER_SPATIAL_MODEL.md](WAFER_SPATIAL_MODEL.md) for research, statistical assumptions, and limitations.

The architecture page stores multiple named architecture definitions. Clicking "Have Agent draw preview" asks the agent to write an executable `draw(ctx)` module and scene JSON, archived by the Harness and executed with Pixi in the frontend. The default grid supports real array dimensions such as 1024×8192, clips to the viewport, and merges grid lines when zoomed out. It supports fit-to-view, zoom, pan, and cell/row/column navigation. The canvas, region coordinates, divider widths/colors, font, theme-color snapshot, and architecture fingerprint are saved. Regeneration and version history are available; after an architecture changes, its old drawing is no longer the current preview. See the [architecture preview Harness](backend/architecture-preview/README.md).

The architecture page also lists executed architecture snapshots from the evaluation framework's `sources/00_experiment.json`; historical snapshots are read-only. The data page links the task's inputs; the conclusions page aggregates reports and downloadable artifacts from its chats. File locations and each chat's Pi session remain independent. New runs receive a snapshot of task materials, preventing concurrent chats from overwriting each other's working files.

After an upgrade, startup assigns each undeleted old conversation to a task with the same name and links uploads actually used by historical messages. To merge tasks, move chats through "Parent task" in the chat-title menu. `?demo=tools` remains the original independent local demo and does not use server-side task management.

## Repair and Yield Evaluation

The [HiGHS evaluation framework and device](backend/repair-evaluation/README.md) are built in. The agent first establishes the data, complete sample roster, redundancy quantities, and repair rules, then modifies the current conversation's `device.py` and runs experiments through `plan` / `run`. The CCR device supports globally shared spare rows within a region and local spare columns grouped by `col % N` within each segment; segments use the confirmed section/subsection mapping. The framework preserves per-sample plans, yield, bounds for unresolved samples, and code/input fingerprints. Each conversation has an independent copy. `PIXEL_CCR_DEVICE` selects the added CCR template; existing custom files are not overwritten. Prepare Python and highspy dependencies as described in the framework documentation.

## Deployment and Backup

- Set `PIXEL_DATA_DIR` to a persistent data directory outside the release directory; the runtime account needs read/write access.
- Start only one main service instance. Linux uses an interprocess lock to protect the same data directory from duplicate startup.
- For external deployment, use a same-origin HTTPS reverse proxy and set `PIXEL_ORIGIN` to the actual address. Disable SSE response buffering and allow long-lived connections.
- An optional systemd unit is provided at [deploy/pixel-chat.service](deploy/pixel-chat.service). Adjust the Node path, working directory, and environment file before installing it; it cleans up all service child processes when the service stops.
- Stop the service before backing up the entire data directory, including SQLite, native session files, attachments, and artifacts. Back up model configuration separately and store credentials separately. Do not copy only the live SQLite main file while ignoring the WAL.
- This version soft-deletes conversations and retains native data and usage. Administrators manage disk capacity; there is no background data-cleanup job.

## Directories and Collaboration

Keep `fronted/` and `backend/`. `packages/contracts/` contains types, request validation, and event examples. See the [contract documentation](packages/contracts/README.md) for the protocol and the [backend documentation](backend/README.md) for deployment configuration.

This implementation did not run tests, builds, or automated browser acceptance checks, in accordance with the project agreement. Follow the [manual acceptance checklist](MANUAL_CHECKS.md) to verify real models, concurrency, cancellation, reconnection, and recovery.

## Pixel Grid and Appearance

On desktop, the left navigation defaults to one fifth of the current window width. Drag its right edge to resize; the browser remembers the value. Double-click the edge to restore the default ratio. Dragging snaps to the integer pixel grid; the sidebar is at least 120 units wide and at most half the window, while leaving at least 240 units for the main area. The edge also supports left/right arrow keys for resizing and Enter to restore the default. Narrow screens continue to use a collapsible drawer.

`fronted/src/pixelGrid.ts` calculates the grid before the first render and whenever the window, visible viewport, or DPR changes. Normal windows, including 1440p, use 2×2 device pixels; 3×3 is used only when the visible viewport reaches 2880 physical pixels wide and 1800 high. The CSS base unit is that integer scale divided by `devicePixelRatio`; Canvas uses the same scale. Body text consistently uses Fusion Pixel 12px at 12 grid units; icons are SVGs on a 16×16 integer grid. The theme follows the system by default, with light and dark options; the choice is saved in the current browser.

This is an integer device-pixel ratio, not a fixed visual font size; additional system scaling may still affect the display. The font comes from [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font), with licenses in `fronted/public/fonts/licenses/12/`. See [AGENTS.md](AGENTS.md) for the design guidelines.
