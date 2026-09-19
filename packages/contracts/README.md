# HTTP contract

All endpoints start with `/api`. Dates are epoch milliseconds. Errors use `ApiError`.
Cookie authentication is same-origin. JSON writes must send `Content-Type: application/json`.

- POST `/auth/login` -> `{ user }`; POST `/auth/logout` -> `{ ok: true }`.
- GET `/me` -> `{ user }`; POST `/auth/password` with `changePasswordSchema` -> `{ ok: true }` (revokes all login sessions).
- GET/POST `/admin/users` -> `{ items: User[] }` / `User`; PATCH `/admin/users/:id` -> `User`; POST `/admin/users/:id/password` -> `{ ok: true }`.
- GET `/conversations?q=...` -> `{ items: Conversation[] }` (includes message projections); POST -> `Conversation`; GET/PATCH `/conversations/:id` -> `Conversation`; DELETE -> `{ ok: true }`.
- POST `/conversations/:id/runs` with `CreateRunInput` -> `Run` (202; replay returns existing run, mismatched key reuse is 409).
- GET `/runs/:id` -> `Run`; POST `/runs/:id/cancel` -> `Run`.
- GET `/runs/:id/events?after=0` -> SSE. Each `event: run` has JSON `RunEvent` data and numeric `id`; reconnect may use Last-Event-ID. Replay is ordered, durable, and continues until terminal status.
- GET `/uploads` -> current user's shared uploads; POST multipart with one `file` -> `FileRecord`; GET `/uploads/:fileId` -> owned upload download, independent of any conversation.
- GET `/conversations/:id/files` -> shared uploads plus this conversation's artifacts. Legacy POST multipart remains supported but now creates a user-owned upload. GET `/conversations/:id/files/:fileId` -> owned upload or this conversation's artifact download.
- `FileRecord.conversationId` is `null` for shared uploads, a conversation ID for artifacts. Run `fileIds` can reference any upload belonging to the current user, plus artifacts of the current conversation. Sharing never crosses users; deleting a conversation does not delete uploads.
- GET `/models` -> `{ items: ModelOption[] }` (no credentials).
- GET `/usage` or `/admin/usage` -> `UsageResponse`; query: `from`, `to` (epoch ms, inclusive), `modelId`, admin-only `userId`, `offset` (default 0), `limit` (default 100, max 500). Summary covers all matching records, detail is paginated.

Modes are product prompt directions, not separate execution environments. Server validates every ID and owner. A run has one user message and zero or more assistant messages. `message.updated` is an upsert. Initial history is fetched before opening an SSE subscription; delta application must use event IDs or refresh the authoritative history to avoid replay duplication.

The UI groups a run's assistant messages into one continuous reply. `tool.status.messageId` associates a tool with its native assistant message; conversation snapshots include `Message.toolCalls`, reconstructed from durable events (including older events without `messageId`). Tools appear inline between model rounds and remain visible after reload. Terminal runs mark unfinished tool calls as interrupted.

`@pixel/contracts/charts` is an authored ESM subpath with TypeScript declarations. It defines the six pixel chart tool schemas, validation, the `pixel-chart/v1` text envelope, and data-table/Markdown projection. Successful named chart tools return this envelope through the existing `tool.status.text` field (maximum 48000 characters). No HTTP schema or database migration is required. See [chart tools](../../PIXEL_CHART_TOOLS.md).

`Conversation.lastRun` retains the latest terminal status/error after refresh; `activeRun` is null when idle. Usage `modelId` is the selected configuration key; nullable `actualProvider`/`actualModel` retain the native invocation identity. Costs remain null unless the administrator has explicitly verified pricing for the matching actual model. Unknown values are not zero.
