# HTTP contract

All endpoints start with `/api`. Dates are epoch milliseconds. Errors use `ApiError`.
Cookie authentication is same-origin. JSON writes must send `Content-Type: application/json`.

- POST `/auth/login` -> `{ user }`; POST `/auth/logout` -> `{ ok: true }`.
- GET `/me` -> `{ user }`; POST `/auth/password` with `changePasswordSchema` -> `{ ok: true }` (revokes all login sessions).
- GET/POST `/admin/users` -> `{ items: User[] }` / `User`; PATCH `/admin/users/:id` -> `User`; POST `/admin/users/:id/password` -> `{ ok: true }`.
- GET `/tasks` -> `{ items: EvaluationTask[] }`; POST with `{ name }` -> `EvaluationTask`; GET `/tasks/:id` -> `TaskDetail`; PATCH with `{ name }` -> `EvaluationTask`. Tasks are user-owned.
- POST `/tasks/:id/architectures` and PATCH `/tasks/:id/architectures/:architectureId` with `{ name, description }` -> `TaskArchitecture`. Evaluated source snapshots are listed read-only alongside saved definitions. Task details also include previewable `report.md` files (up to 100 KB each); other products remain downloadable.
- POST `/tasks/:id/files` with `{ fileId }` associates an owned upload with a task. Task details aggregate these uploads and artifacts from its non-deleted conversations.
- Conversation create/update accepts `taskId`; omitted on create starts a new task. Moving an active conversation is rejected. Existing source files stay in place; artifacts follow their conversation, previously associated uploads remain available to the old task. Search matches task names as well as chat titles and messages.
- GET `/conversations?q=...` -> `{ items: Conversation[] }` (includes message projections); POST -> `Conversation`; GET/PATCH `/conversations/:id` -> `Conversation`; DELETE -> `{ ok: true }`.
- POST `/conversations/:id/runs` with `CreateRunInput` -> `Run` (202; replay returns existing run, mismatched key reuse is 409).
- GET `/runs/:id` -> `Run`; POST `/runs/:id/cancel` -> `Run`.
- GET `/runs/:id/events?after=0` -> SSE. Each `event: run` has JSON `RunEvent` data and numeric `id`; reconnect may use Last-Event-ID. Replay is ordered, durable, and continues until terminal status.
- GET `/uploads` -> current user's shared uploads; POST multipart with one `file` -> `FileRecord`; GET `/uploads/:fileId` -> owned upload download, independent of any conversation.
- GET `/conversations/:id/files` -> shared uploads plus this conversation's artifacts. POST multipart creates a user-owned upload and associates it with the conversation’s task. GET `/conversations/:id/files/:fileId` -> owned upload or this conversation's artifact download.
- `FileRecord.conversationId` is `null` for shared uploads, a conversation ID for artifacts. Run `fileIds` can reference any upload belonging to the current user, plus artifacts of the current conversation. Sharing never crosses users; deleting a conversation does not delete uploads.
- GET `/models` -> `{ items: ModelOption[] }` (no credentials).
- GET `/usage` or `/admin/usage` -> `UsageResponse`; query: `from`, `to` (epoch ms, inclusive), `modelId`, admin-only `userId`, `offset` (default 0), `limit` (default 100, max 500). Summary covers all matching records, detail is paginated.

Modes are product prompt directions, not separate execution environments. Server validates every ID and owner. A run has one user message and zero or more assistant messages. `message.updated` is an upsert. Initial history is fetched before opening an SSE subscription; delta application must use event IDs or refresh the authoritative history to avoid replay duplication.

The UI groups a run's assistant messages into one continuous reply. `tool.status.messageId` associates a tool with its native assistant message; conversation snapshots include `Message.toolCalls`, reconstructed from durable events (including older events without `messageId`). Tools appear inline between model rounds and remain visible after reload. Terminal runs mark unfinished tool calls as interrupted.

`@pixel/contracts/charts` is an authored ESM subpath with TypeScript declarations. It defines the six pixel chart tool schemas, validation, the `pixel-chart/v1` text envelope, and data-table/Markdown projection. Successful named chart tools return this envelope through the existing `tool.status.text` field (maximum 48000 characters). No HTTP schema or database migration is required. See [chart tools](../../PIXEL_CHART_TOOLS.md).

`Conversation.lastRun` retains the latest terminal status/error after refresh; `activeRun` is null when idle. Usage `modelId` is the selected configuration key; nullable `actualProvider`/`actualModel` retain the native invocation identity. Costs remain null unless the administrator has explicitly verified pricing for the matching actual model. Unknown values are not zero.

`@pixel/contracts/architecture-scene` shares the Pixi drawing metadata contract and validation between the agent publication harness, server and browser. `TaskArchitecture.fingerprint` identifies the current definition; `previews` contains validated, matching scene versions and script downloads. `previewIssues` exposes stale or rejected publications. New previews include `scene.draw` with real array dimensions, default grid colors and Agent-authored geometry records, plus an archived JavaScript module exporting `draw(ctx)`. The browser executes this module with Pixi, world/overlay layers, visible bounds, theme colors and pixel text helpers. Legacy integer primitive scenes remain supported. See the [harness](../../backend/architecture-preview/README.md).
