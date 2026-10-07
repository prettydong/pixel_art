# Frontend Interactive Tools and Markdown

## Demo Entry Point

Append `?demo=tools` to the frontend URL, for example `http://localhost:5173/?demo=tools` in development. The login page and model menu also offer "Open local tool demo". No login or model configuration is required. The demo reuses the chat interface but does not call conversation, upload, run, or account APIs.

Dependencies use npm workspaces and `package-lock.json` at the project root. Do not install in `fronted/` using the old standalone lockfile. Follow the README for startup: install dependencies at the root, build shared contracts first, then start the frontend. This development did not run builds, tests, or browser acceptance checks.

The regular workspace continues to use the existing login and backend conversations. Markdown rendering also applies to assistant messages in the regular workspace; interactive tools accepting submissions are currently connected only in the local demo.

Real Pi conversations now support six read-only pixel-chart tools: bar, line, area, pie, scatter, and heatmap. Charts appear directly in replies; see [chart tools](PIXEL_CHART_TOOLS.md). Fixed examples are available at `?demo=charts`; these charts do not require submitted answers.

## Three Demo Flows

Select a direction on the home page or in the input area, then send any nonempty message to start the fixed demo.

| Direction | Interaction | Simulated Reply |
| --- | --- | --- |
| Data analysis | Single-choice goal → multiple-choice metrics | Markdown configuration table, read-only task list |
| Product architecture settings | Product name, array size, redundancy resources, optional notes | Parameter table, JSON code block |
| Repair rule design | Confirm or cancel an example rule | Corresponding record or cancellation explanation |

These flows only collect input. They do not read attachments, compute failure metrics, validate real architectures, or perform repairs. Numeric form fields support finite decimal values and configured range limits; example ranges do not represent real product specifications.

After a choice or form submission, controls lock, the original message displays the answer, and the user's answer is appended to the conversation. Tools cannot be submitted again before the simulated reply completes. A regular new message invalidates previously unanswered tools. Stopping or refreshing retains only generated body text and does not add tools that have not fully appeared. A conversation's simulated reply may continue while another conversation is selected.

## Component Interfaces and Data

- `fronted/src/chatTypes.ts` defines frontend message extensions: existing server message fields are retained, with optional `tools` and local-reply `delivery` added; server contracts are unchanged.
- `InteractiveTools({ tools, disabled, onSubmit })` renders single choice, multiple choice, confirmation, and forms. It returns a `ToolResult` containing `toolId`, `type`, and `value`. Single-choice values are option IDs; multiple-choice values are arrays of option IDs; confirmations are booleans; forms map field IDs to text/numbers. Empty optional fields are omitted.
- `MarkdownMessage({ text })` renders only the body. It does not interpret body text, task lists, or code blocks as executable tools. It supports common GFM, code copying, and local horizontal scrolling, without raw HTML, equations, Mermaid, or syntax highlighting.
- `chatTools.ts` validates tool configuration and answers at restoration and submission boundaries. Corrupt tools individually fall back to a noninteractive notice. `messageMarkdown` adds tool questions, options, fields, and answers to copied/exported content.
- `useDemoWorkspace.ts` manages demo conversations, synchronous submission locks, incremental output, and persistence; `demoReplies.ts` provides fixed flows. Future real-agent integration needs to normalize tools at the receiving boundary and connect submission callbacks to the backend; components do not make requests directly.

Local data is stored under `pixel-chat-tools-v1`. If no new history exists on first use, compatible data is read from the old `pixel-chat-v1` key; the old key is neither deleted nor uploaded. Submitted answers, tool states, and body text persist. Unsubmitted control input stays only in the currently mounted component. After refreshing or leaving a conversation, unanswered tools can be filled in again. If storage is unavailable, a notice appears and the current page remains usable.

## Manual Acceptance Checks

The following checklist is pending execution and does not indicate that checks have passed:

1. Complete all three flows in `?demo=tools`. Empty single-choice and multiple-choice submissions should show a validation message; multiple choice requires at least one item. Check blank required fields, invalid numbers, minimum/maximum values, and empty optional fields. Try both confirm and cancel.
2. Click submit repeatedly in quick succession. Only one answer and one simulated reply should be appended. Tools are disabled during replies; submitted tools remain locked and display their answers.
3. Send another message while a tool is unanswered; the old tool should become invalid. Stop during a reply; retain partial body text without unfinished tools. Sending a new message should still work.
4. Open two demo conversations, switch during a reply, and return; content must not cross conversations. Deleting a running conversation must not allow timers to recreate it. After refreshing, submitted answers stay locked and interrupted replies do not resume automatically.
5. Check old local conversations, attachment names, title search, and renaming. Copying an entire reply and exporting Markdown should include questions, options, and answers. Code copying preserves line breaks; denied clipboard access shows a notice.
6. Back up demo data first, then change a tool's `type` to an unknown value in browser local storage, remove its options, or corrupt its result. Refreshing should degrade only that tool while retaining other messages. An array-valued `status` should also be treated as corrupt.
7. Check headings, quotes, lists, tables, code blocks, and unclosed code fences during incremental output. Task lists cannot submit actions; raw HTML and dangerous link protocols must not execute. Wide tables and long code scroll only within their own containers.
8. Scroll upward to read a long reply; new content must not force scrolling to the bottom. Following resumes after returning to the bottom. Focus should remain stable when using the keyboard for single choice, multiple choice, and forms.
9. Switch between light, dark, and system themes, narrow the window, and adjust browser zoom. Controls, text, and borders must retain the existing pixel grid without making the main page overflow horizontally.
10. Use the browser Network panel to inspect demo operations: create, search, rename, upload, send, stop, and delete. No `/api` requests should appear. Returning to the regular workspace should preserve existing login, real conversations, files, and execution flows.
