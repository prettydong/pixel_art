# Local deployment

- Browser URL: http://124.223.31.42:12300/proxy/20002/
- Allowed browser origin: http://124.223.31.42:12300
- Bind address: 127.0.0.1:20002
- Project: /home/zdong/raDev/pixel_art
- Persistent data: /home/zdong/raDev/pixel_art.runtime/data
- Process manager state: /home/zdong/raDev/pixel_art.runtime/pm2
- Configuration: project-root `.env` and `backend/models.json`

Run these commands from the project directory:

To reinstall and build on Linux x64 (the upstream lockfile omits Rollup's Linux binary):

```sh
npm ci
npm install --no-save --package-lock=false @rollup/rollup-linux-x64-gnu@4.63.4
npm run build
```

Process management:

```sh
PM2_HOME=/home/zdong/raDev/pixel_art.runtime/pm2 pm2 start deploy/ecosystem.config.cjs
PM2_HOME=/home/zdong/raDev/pixel_art.runtime/pm2 pm2 status
PM2_HOME=/home/zdong/raDev/pixel_art.runtime/pm2 pm2 logs pixel-art --lines 50
PM2_HOME=/home/zdong/raDev/pixel_art.runtime/pm2 pm2 restart pixel-art
PM2_HOME=/home/zdong/raDev/pixel_art.runtime/pm2 pm2 stop pixel-art
```

PM2 restarts the application on failure. Automatic startup after a machine reboot is not configured.

The initial administrator username is `admin`; change the generated password after signing in.

OpenCode Go is configured in `backend/models.json` with 27 models from the local
OpenCode 1.18.29 catalog (2026-09-20). Muse Spark 1.3 Contributor is listed first,
matching the local most-recent Go selection. Protocols follow the local catalog;
Anthropic-compatible models use a base URL without the trailing `/v1` because
Pi's Anthropic client appends `/v1/messages` itself.

Pi resolves credentials through `scripts/opencode-go-auth.mjs --key`, reading the
existing `opencode-go` entry from the service user's OpenCode credential store.
No credential is copied into the project or the frontend. The default store is
`~/.local/share/opencode/auth.json`; `XDG_DATA_HOME` or `PIXEL_OPENCODE_AUTH_FILE`
can override it. Never run the `--key` command in a visible terminal; use `--check`
to confirm availability without displaying the key. Requests use a stable,
hashed conversation identifier in `x-opencode-session`.

Restart the service after changing the model catalog. Pricing remains unknown:
Go subscription usage is not represented as pay-as-you-go model billing here.
`node scripts/check-opencode-go.mjs <model-id>` sends one small real request for
each requested model and reports success without printing credentials.

The gateway forwards `/proxy/20002/` to this service and strips that prefix. Frontend resources and API URLs are relative to the page directory. Sign in to the gateway before opening the browser URL above. `PIXEL_ORIGIN` is the browser origin only, without `/proxy/20002/`; write requests require an exact origin match.

Back up the entire persistent data directory while the service is stopped. Keep configuration and credentials in a separate protected backup.

## Synthetic fail data

The admin task `1024×1024 模拟失效数据` contains `fails.csv`, `roster.csv`,
`manifest.json`, and `README.md` from
`datasets/synthetic-fails-1024x1024-seed20260920/`: 100 synthetic samples,
10 zero-fail samples, and 18,329 unique per-sample fail coordinates. Coordinates
are zero-based (0–1023); no redundancy configuration or repair result is implied.

Files placed only in a user's `datasets/` directory are readable by the agent,
but do not automatically appear in the task data panel. Use the existing upload
and task-file APIs to register them. `scripts/import-synthetic-dataset.mjs` does
this for the named task, reads the login password from stdin, compares hashes on
repeat imports, and refuses to replace different existing data. It creates no
model run and logs out its temporary login session. Open the task's **数据** view
to access the registered files; other tasks can use **从已有上传添加**.

The data panel now previews CSV tables (first 50 rows; up to 3 MB / 50,000 rows /
256 columns). Selecting `manifest.json` with the matching roster and fail files
opens the synthetic dataset summary and sample selector, including zero-fail
samples. The SVG overview combines 8×8 array cells into each of 128×128 bins,
requires no WebGL, and validates sample membership, bounds, duplicate coordinates,
and declared counts before plotting. No uploaded HTML or scripts are executed.
This release was compiled and its authenticated file downloads and deployed
relative assets checked over HTTP; the Citrix browser display remains a manual
client check.

## Architecture templates

In each task's **架构 → 新建架构**, the parameter editor offers four editable
examples: 1024×1024 row/column redundancy, row-only redundancy, eight column
resource groups, and a 1024×8192 eight-group array. Array rows/columns, input
coordinate base, spare rows, column group count/offset, per-group spare columns,
and notes can be edited. One column-capacity value means that capacity for every
group; comma-separated values specify each group independently. All resources
are per sample; replacements cover full rows/columns and groups cannot borrow
resources. These examples make no assumptions about ECC or bank/segment sharing.

The versioned `pixel-architecture` JSON remains in the existing `description`
field, with native `array` and `device` field names. Existing free-text or unknown
JSON definitions remain in custom-text mode without discarding unknown fields.
Only the known format is reopened as structured parameters. Saving uses the
existing authenticated architecture API/fingerprint handling and does not start
a model run or repair evaluation. The task context passes the description to the
agent as before; it is not itself an executable experiment plan.

## Architecture drawing activity

Architecture headings toggle each record's preview, definition, and detailed
activity panel. **全部展开 / 全部折叠** controls the current task's records. Folded
records retain their names, parameter summaries, drawing status and error hints.
Preferences are stored per task in the browser when local storage is available;
folding unloads the preview renderer but does not cancel the server-side run.

Architecture records show a run-scoped live activity panel while the agent draws:
streamed assistant text, bounded recent tool output, elapsed time, connection
status, and terminal errors. The visible architecture drawing has SSE priority;
other active runs refresh their conversation snapshots every three seconds while
preserving the existing single-SSE limit. Scrolling up pauses automatic following.
Only a published preview belonging to the drawing conversation and created after
the run started is labelled ready; a completed agent run alone is not proof of a
valid preview. The initial drawing request asks the agent to narrate key steps,
but the UI does not fabricate narration or percentages when no output exists.

## Card interaction regression

`scripts/check-card-ui.mjs` checks the UI through a local `/proxy/20002/` proxy using
browser-local demo data. It does not call a model or modify server conversations.
Set `PIXEL_UI_BASE_URL` to a frontend preview or the running service, and
`PIXEL_PLAYWRIGHT_MODULE` to an installed Playwright module if it is not locally installed.
`PIXEL_CHROME` optionally selects a Chromium executable.

The checks cover desktop layouts, DPI scaling, settings, repeated selections,
disabling motion during a transition, slow or blocked graphics modules, resizing,
reduced motion, WebGL being disabled, and minimum font sizes of 12/25px (including
DPR 1.5 and WebGL-disabled combinations). The font-policy cases reproduce the
previous 87rem single-column regression and check particle-canvas dimensions.
Results and screenshots are written to
`PIXEL_UI_EVIDENCE` (default `/tmp/pixel-art-browser-evidence/fixed`).
These simulate graphics restrictions; they do not certify a particular Citrix client or policy.
