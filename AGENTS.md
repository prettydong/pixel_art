# Project Collaboration Guidelines

This file records the design and collaboration requirements confirmed by the user and applies to the entire project. Future changes must follow these guidelines; new user instructions take precedence.

## Communication and Responsibilities

- Be calm, direct, and factual. Do not flatter the user. Describe changes actually completed, and do not present unverified results as verified.
- Keep the directory names `fronted/` and `backend/`. Do not rename `fronted` to `frontend` without authorization. Frontend development is the current priority.
- This is a debug version: support non-empty passwords of 1–256 characters without complexity rules, defaulting to `123456` for account creation/reset and debug login. Keep frontend and API validation consistent. Fresh non-production startup may create `admin` only when no users exist; never overwrite existing passwords on restart.
- The built-in DEJOA demo loads the fixed three-wafer inputs and R128 C2 / R64 C2 / R128 C1 configurations into a fresh task with nine draft combinations. Loading the demo must not start an agent, generate solver code, enqueue repair jobs, or fabricate results; the presenter starts Solver manually.
- Conclusions must remain accessible even without chat artifacts. Each new Solver submission generates and saves statistical conclusions from current results by default, updating as jobs finish. The Automatic conclusions switch in Settings applies to future submissions, remembers the browser preference, and leaves existing conclusions intact when disabled. Compare identical wafer inputs and retain architecture version / engine identities; do not treat unresolved repairMost results as proven infeasible.
- Solver results and Conclusions provide bar and line charts across wafers, with Chip yield, Region yield, and Chip yield gain metrics. Keep detailed tables available in collapsible sections. Preserve missing results as gaps, compare separate real / synthetic product groups, and calculate aggregate rankings only on shared wafer inputs with counts as weights. Percentage plots use a 0–100 axis. Do not shade an entire chart category on hover; keep value inspection available.
- The user has explicitly stated that they will test manually. Do not run test suites or automated browser acceptance checks by default. The user has also requested deployment after every program change by default, without asking for confirmation again. Perform the builds, service updates, health checks, and static asset checks required for deployment; fix failures before proceeding. Confirm the actual runtime directory and retain artifacts that allow rollback before deployment. Avoid restarting services in a way that interrupts running tasks.
- Follow the rules below when calling `agy`. Consider delegation only for independent subtasks with clear benefits; calling it after every change is not required.
- The primary Codex agent is responsible for understanding requirements, architecture, integration, and verifying agent conclusions. Do not adopt `agy` suggestions without checking them. Do not edit the same files concurrently with an agent, and do not automatically delegate destructive operations, credential handling, external publishing, or irreversible changes. When the user explicitly requests `agy`, report its results and any unresolved issues.

## Rules for Calling agy

- **Assess the benefit first**: The primary Codex agent should directly handle simple changes, code already checked, and tasks whose waiting and review costs exceed their benefits. Each delegated task must have a single objective, a clear scope, and be independently completable.
- **Provide context by default**: Run `agy --print` in the project directory, with read-only behavior by default. Provide the necessary code directly, including paths and line numbers, along with relevant logs or proposals. Instruct it not to call tools or read files itself. Do not include credentials or unrelated private information. Prefer passing prompts through a subprocess argument array to avoid shell interpolation.
- **Require evidence of reading capability**: Allow it to read the project itself only when successful reading has already been demonstrated in the current environment, or when the user explicitly requests capability verification. If prior login or read-permission failures remain unresolved, do not repeatedly delegate tasks that depend on that capability. Do not automatically broaden permissions or change authentication configuration.
- **Limit execution time**: By default, make one call per subtask and set an actual process timeout, normally 45 seconds and no more than 60 seconds by default. `yield_time_ms` is not a process timeout. Continue independent work while waiting. At the timeout, terminate that invocation and its dedicated child processes, then take over the task without affecting other `agy` processes.
- **Stop repeated attempts after failure**: After a login failure, restricted read access, or timeout, stop automatic retries of the same kind. Carry known failure states across turns. Allow one targeted retry only when the blocking condition has changed, or when an approach such as directly providing code removes the failed dependency and still offers a clear benefit. If login also fails in plain-text mode, take over directly. Follow the user's instructions when they explicitly request a retry.
- **Require verifiable output**: Request no more than three key conclusions by default. Code reviews must identify the issue location, triggering conditions, code evidence, and a minimal fix. Proposal analysis must distinguish facts, assumptions, and recommendations. Allow a conclusion that no issues were found, and do not expand the user's scope.
- **Record actual contributions**: In the current task record, distinguish tasks dispatched, results returned, conclusions verified and adopted, and failures taken over. Adopt conclusions only after the primary Codex agent verifies them. Do not count call volume, successful process exits, or generic suggestions as completed checks or fixes.
- **Preserve the project's verification agreement**: The user continues to test functionality manually. Do not automatically run test suites or browser acceptance checks. The primary Codex agent performs the necessary build and deployment checks after every program change as specified above.

## Visual Style: Claude Code–Like

- The interface follows a Claude Code–style look: warm neutral surfaces, one clay accent, system typography, quiet borders, and soft rounded shapes. The former pixel-grid style, pixel font, pixel icons, and shatter transition have been removed at the user's request; do not reintroduce them.
- Sizes are ordinary CSS pixels. There is no design-pixel unit or `rem` grid; `fronted/src/viewport.ts` only sets layout breakpoints (`data-layout`, `data-narrow`), the resizable sidebar width, and canvas render resolution.
- Typography uses three system stacks defined in `styles.css`: `--font-sans` for UI and messages (14 px body, 15 px chat text), `--font-serif` for brand and section headings, and `--font-mono` for code, tool names, and tool output. Do not bundle custom web fonts.
- Icons are the project's own outline SVGs in `fronted/src/Icons.tsx` (24 × 24 viewBox, 2-unit round strokes, shown at 16 px). Add new icons there in the same style; do not use emoji or Unicode symbols as icons.
- Shapes use the radius tokens (`--radius-sm` 6, `--radius` 8, `--radius-lg` 12, `--radius-xl` 18), 1 px borders, and the shadow tokens (`--shadow-sm/md/lg`).
- The user wants the interface lively and a little funny. While a reply runs, `Thinking.tsx` shows a spinning clay spark, a rotating playful verb with a shimmer, and elapsed seconds; the verbs describe waiting and never imply progress or results. `fun.ts` throws spark bursts on send, direction cards, copy, and the brand mark (an easter egg twirl). Messages, cards, panels, dialogs, menus, and charts animate in; buttons give springy press and hover feedback.
- All motion lives under `:root[data-motion="on"]` (the Interface animations setting, defaulting off under `prefers-reduced-motion`), and `fun.ts` checks the same conditions. Animations must never block input, delay data, or move hit areas.
- Each welcome direction card shows a smooth SVG diagram (`fronted/src/EvaluationDiagram.tsx`: fail distribution, CCR architecture, row / CCR col repair) drawn with the card accent and theme tokens. They are illustrations, not results.
- Charts are smooth SVG: polylines with point markers, rounded bars, arc pies, circular scatter points, and rounded heatmap cells, using `--chart-*` and `--heat-*` tokens. Wafer and CCR data maps may stay crisp-edged because each cell is data.
- Architecture drawings put redundancy flush against the main array with no gap, fixed in screen space even after axis transposition: Region-shared row redundancy on the right as vertical strokes "|", CCR col redundancy below as horizontal strokes "—" aligned per segment. Segment labels `S<index>` sit on the array; row-axis ticks sit above it. The global row pool stays shared at Region level and CCR col resources stay independent per segment/subgroup.
- Standard drawings come from the harness starter (`backend/architecture-preview/starter-draw.mjs`, generated with `publish.mjs --init <id> --publish`). Keep layout rule changes in the starter, the README and the prompts together, and keep the drawing prompts short: agents read only the README and task context and do not patch project files.
- Tool calls in replies read like Claude Code: a status dot (running / done / failed), a monospace tool name, and collapsible indented output.
- Do not use vertical accent bars ("|" left borders) on callouts, notes, quotes, tool output, or navigation trees; use a soft tinted background with the radius tokens instead. Table gridlines are fine.

## Layout: Efficient Use of Space, Less Is More

- Conversation content (messages, composer, run status) is centered at `--chat-width` (820 px) with the scroll area spanning the full main width; task panels (architecture, data, Solver, conclusions) use the full width up to 1200 px. Do not add large empty welcome areas.
- Baseline: sidebar 272 px by default (resizable, 20% of the window clamped to 220–320 px), top bar 48 px, composer as a rounded card with a bottom toolbar.
- In an empty conversation, use the remaining area for editing the draft. After the conversation begins, the message area fills the remaining height and scrolls independently, with a compact input box at the bottom.
- Place mode, attachment, and engine selectors in the same compact toolbar, allowing wrapping in small windows. Collapse the sidebar on narrow screens (below 760 px) instead of shrinking content.
- User messages appear as right-aligned bubbles; assistant replies are plain text without avatars or name labels (names remain available to screen readers).
- Remove purely decorative small text, slogans, cards, and status bars. Do not reintroduce marketing copy, duplicate avatars, or nonfunctional modules that occupy space.
- By default, omit explanatory notes, usage tutorials, implementation details, and repeated hints. Prefer letting control labels and the data itself convey meaning. Do not add long UI explanations of a feature after implementing it.
- Keep useful labels, statuses, error messages, and local demo notices. Do not create simplicity by hiding necessary information.

## Light and Dark Themes

- Provide "System / Light / Dark" choices in settings. Default to following the system and remember the user's selection in the current browser.
- Both themes share exactly the same sizes, layout, and functionality; only colors change. Light uses an ivory background (`#faf9f5`) with white surfaces; dark uses a warm charcoal background (`#262624`) with `#30302e` surfaces. Both use the clay accent (`#c96442` light / `#d97757` dark).
- Use semantic variables from `styles.css` for component colors, covering body text, secondary text, borders, hover, selection, disabled states, menus, dialogs, overlays, and shadows. Do not add hard-coded colors to components that work only in one theme.
- `fronted/src/theme.ts` handles preferences and system theme changes. Apply the theme before the first React render. System theme changes affect only users who selected "System"; switching must still work within the current session when storage is unavailable.

## Language

- The product supports English and Simplified Chinese. Default to English on the first visit; do not automatically switch to Chinese based on the browser language.
- Provide a language switch on the login page and in settings, and remember the selection in the current browser. Switching must still work within the current session when storage is unavailable.
- Use `fronted/src/i18n.ts` and `fronted/src/locales/en.ts` for interface copy, including labels, statuses, errors, accessibility descriptions, and application-generated prompt templates. Both languages share the same type stacks and layout.
- Switching languages must not rewrite user messages, saved names, architecture definitions, uploaded content, or historical model replies. Keep mode identifiers in the API compatible.
