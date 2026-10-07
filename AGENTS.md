# Project Collaboration Guidelines

This file records the design and collaboration requirements confirmed by the user and applies to the entire project. Future changes must follow these guidelines; new user instructions take precedence.

## Communication and Responsibilities

- Be calm, direct, and factual. Do not flatter the user. Describe changes actually completed, and do not present unverified results as verified.
- Keep the directory names `fronted/` and `backend/`. Do not rename `fronted` to `frontend` without authorization. Frontend development is the current priority.
- Conclusions must remain accessible even without chat artifacts. Each new Solver submission generates and saves statistical conclusions from current results by default, updating as jobs finish. The Automatic conclusions switch in Settings applies to future submissions, remembers the browser preference, and leaves existing conclusions intact when disabled. Compare identical wafer inputs and retain architecture version / engine identities; do not treat unresolved repairMost results as proven infeasible.
- Solver results and Conclusions provide pixel-grid bar and line charts across wafers, with Chip yield, Region yield, and Chip yield gain metrics. Keep detailed tables available in collapsible sections. Preserve missing results as gaps, compare separate real / synthetic product groups, and calculate aggregate rankings only on shared wafer inputs with counts as weights. Percentage plots use a 0–100 axis. Do not shade an entire chart category on hover; keep value inspection available.
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

## Pixel Style: A Unified Grid

- Use a genuinely unified pixel style: text, icons, borders, spacing, and controls must all follow the same grid. Merely adding pixel illustrations does not satisfy this requirement.
- With the 1440p adaptation, normal windows use **1 design pixel = 2 × 2 physical pixels**. Use 3 × 3 only when the visible viewport is at least 2880 physical pixels wide and 1800 physical pixels high. Read screen dimensions, window dimensions, and `devicePixelRatio` before rendering. The CSS base unit is this integer scale divided by `devicePixelRatio`, in px; Canvas must use the same scale.
- `fronted/src/pixelGrid.ts` is the entry point for grid calculations. In CSS, `1rem` represents one design pixel. Use whole grid units for dimensions, and snap necessary centering offsets to the grid as well. Do not arbitrarily introduce independent px font sizes, scaling factors, or fractional grid offsets.
- In JavaScript, use `getPixelUnit()` to read `--pixel` for grid conversions. Do not use the root element's computed `font-size`: the browser's minimum font-size policy may inflate that value without changing `rem` layout dimensions accordingly.
- Recalculate when switching screens, resizing the window, or changing browser zoom. Base the layout on the actual window rather than the entire screen's dimensions.
- Integer physical-pixel scales correspond to different CSS font sizes at different DPR values. Browsers cannot bypass additional operating-system display scaling, so do not claim that every display environment can be completely free of anti-aliasing.
- Use the local Fusion Pixel 12px font for both English and Chinese, with a font size of `12rem` and a font weight of 400. Do not mix different native font grids for headings and body text. Retain the font license. Allow fallback fonts for user input that the font does not cover, to preserve readability.
- Use the project's own SVG icons on a 16 × 16 grid, displayed at `16rem × 16rem`, with outlines aligned to integer grid coordinates and `crispEdges`. Do not introduce smooth line icons or replace pixel icons with decorative system Unicode symbols.
- Keep square corners, solid colors, and necessary hard-edged shadows. Avoid rounded corners, blurred shadows, gradients, rotation, and decorative animations that misalign the grid.

## Layout: Efficient Use of Space, Less Is More

- The main area must fill the available width. Do not restore a narrow centered content column or large empty welcome areas.
- The confirmed compact baseline is a main-area margin of 4 grid units, a sidebar width of 144 units, and a top-bar height of 32 units; default text is 12 units with a line height of 16 units. Continue to prioritize efficient use of space and usability when making adjustments.
- In an empty conversation, use the remaining area for editing the draft. After the conversation begins, the message area fills the remaining height and scrolls independently, with a compact input box at the bottom.
- Place mode, attachment, and engine selectors in the same compact toolbar, allowing wrapping in small windows. Collapse the sidebar on narrow screens instead of shrinking the pixel unit to force content to fit.
- Remove purely decorative small text, English slogans, star dots, characters, cards, and status bars. Do not reintroduce marketing copy, duplicate avatars, or nonfunctional modules that occupy space.
- By default, omit explanatory notes, usage tutorials, implementation details, and repeated hints. Prefer letting control labels and the data itself convey meaning. Do not add long UI explanations of a feature after implementing it.
- Keep useful labels, statuses, error messages, and local demo notices. Do not create simplicity by hiding necessary information.

## Light and Dark Themes

- Provide "System / Light / Dark" choices in settings. Default to following the system and remember the user's selection in the current browser.
- Both themes must share exactly the same grid, font sizes, layout, and functionality; only colors change. Use a warm white background with purple accents for the light theme, and retain the deep purple-gray background for the dark theme.
- Use semantic variables from `styles.css` for component colors, covering body text, secondary text, borders, hover, selection, disabled states, menus, dialogs, overlays, and shadows. Do not add hard-coded colors to components that work only in the dark theme.
- `fronted/src/theme.ts` handles preferences and system theme changes. Apply the theme before the first React render. System theme changes affect only users who selected "System"; switching must still work within the current session when storage is unavailable.

## Language

- The product supports English and Simplified Chinese. Default to English on the first visit; do not automatically switch to Chinese based on the browser language.
- Provide a language switch on the login page and in settings, and remember the selection in the current browser. Switching must still work within the current session when storage is unavailable.
- Use `fronted/src/i18n.ts` and `fronted/src/locales/en.ts` for interface copy, including labels, statuses, errors, accessibility descriptions, and application-generated prompt templates. Both languages share the same pixel grid, font, and layout.
- Switching languages must not rewrite user messages, saved names, architecture definitions, uploaded content, or historical model replies. Keep mode identifiers in the API compatible.
