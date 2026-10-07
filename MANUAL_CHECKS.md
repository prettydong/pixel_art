# Manual Acceptance Checks

This development does not automatically run tests, builds, or browser acceptance checks. Users should perform the steps below after configuring models, installing dependencies, and building. Model calls incur real usage.

## Accounts and Access

1. Sign in as the initialized administrator and create regular users A and B. Sign out and sign in as each user; confirm that neither sees the other's history.
2. Sign in as A and obtain A's conversation, task, and file IDs from browser developer tools. Sign in as B and access those IDs; HTTP must reject access without returning A's data. Administrator usage permissions must not automatically grant access to all users' conversations.
3. After A changes their password, previous browser login sessions must become invalid. An administrator resetting A's password must also invalidate old logins.
4. Disable A as an administrator while A has a running task: the task must stop and A's login must become invalid; historical usage remains queryable. After re-enabling A, sign in again with the current password.

## Conversations, Concurrency, and Files

1. Create two conversations and ask the agent to create `marker.txt` with `session-a` and `session-b`, respectively. Run them concurrently; files and replies must not appear in the other conversation.
2. Submit a new execution from another tab while the same conversation is running; it should report a busy state. Another conversation should still accept submissions.
3. Resend the same submission with the same idempotency key; only the original run should be returned. Reusing the key with different body text should produce a conflict.
4. Upload a small text or CSV file, ask the agent to read and analyze it and generate a file, then confirm that both attachments and artifacts can be downloaded. Downloads must not accept arbitrary server paths supplied by the client.
5. Ask the agent to create a symbolic link pointing outside the conversation directory; the file API must not treat it as a downloadable artifact. This checks the HTTP file-access boundary, not an OS sandbox for the agent.
6. Rename titles, search body text, switch modes, and export Markdown. Data must remain after refreshing. Deleted conversations should disappear from the list while usage is retained.

## Streaming and Lifecycle

### User Directories, Shared Uploads, and Skills

1. Stop the service and back up data before upgrading. After starting the new version, confirm that attachments and artifacts from old messages remain downloadable. Old directories are retained; new locations are `users/<userId>/conversations/<id>/`, with old uploads under `uploads/legacy/<id>/`. Restarting again must not duplicate attachment registration or usage.
2. Upload a file in conversation A, create conversation B as the same user, select "Add to this analysis" under "Shared uploads", and confirm that no re-upload is needed and Pi can read the original file. After deleting A, the shared file remains downloadable in B. Other users cannot list, download, or submit this file ID.
3. Analyze concurrently in two conversations. Ask Pi to report its startup directory and `PIXEL_WORK_DIR`: both startup directories are the user root, while each work directory belongs to its current conversation. Scripts, intermediate data, and artifacts must go into their respective work directories. Pi's cwd after restoring an old conversation should also be the user root.
4. Ask Pi to read the user's `.pi/skills/data-analysis/SKILL.md`. After modifying that skill at the user's request, start a new run and confirm that the change remains and takes effect. Another user's copy must remain unchanged.
5. Place a fully written regular file in shared uploads, refresh the file list, and confirm that it can be selected and downloaded after registration. A zero-byte file is still a file. Refreshing during an upload must not register `.incoming` temporary files. Same-named uploads from different conversations must retain two IDs.
6. Analyze A/B/C, sample_counts, and metadata from `uploads/dram_1024_abc/`. Confirm 100 samples per group and means of 50/60/70, retaining C's zero-fail samples. Write reports to the current conversation's artifacts without overwriting uploads.

### Execution and Recovery

1. Generate a long reply, refresh the page, switch conversations, disconnect temporarily, and reconnect. The original task continues; text must not be duplicated or regress, and the final content must match history.
2. Stop while a tool is running. Confirm that background script child processes are also cleaned up, rather than only stopping UI updates. The same conversation must then accept another submission.
3. Interrupt the model service during a conversation and check for a comprehensible error, terminal state, and ability to resubmit. RPC acceptance of a prompt does not mean execution succeeded; retries must not cause premature completion.
4. Stop the service normally while a task is running, then restart. The task must show interruption and must not automatically repeat scripts. Also check a forced exit and confirm that no Pi/script processes remain running.
5. Start another service instance using the same data directory. The second instance must be rejected rather than writing concurrently or starting duplicate tasks.

## Usage and Appearance

### Reply Speed, Tool Details, and Reasoning Expansion (Pending Manual Verification)

1. Generate a long reply in a real-model conversation. Confirm that `token/s`, output tokens, and model duration update continuously below the reply. Show "Estimated" when model usage is unavailable; switch to actual output tokens when it becomes available. Speed is total output tokens across rounds divided by total model duration across rounds, including first-token wait and excluding tool execution time.
2. Request attachment reading and a tool with continuous text output. Click its row or use Tab + Enter/Space to expand it. Confirm that arguments, live output, completion/failure state, and execution duration are visible; streaming must not collapse an expanded tool. Tool output is a cumulative snapshot and must not be appended repeatedly. Output beyond 64000 characters must show a truncation notice.
3. Use a model that returns thinking content. Confirm that "Reasoning" is collapsed by default, updates incrementally when expanded, and remains separate from body text. Models without thinking content must not show an empty expansion area; signatures and binary image data must not appear.
4. Refresh, switch conversations, and reconnect during execution. Reasoning must not duplicate, tool arguments must not be overwritten by results, and completed tools must not revert to running. After completion, refreshing or restarting the service must retain details and final speed. Old tool records with missing output must explicitly indicate that no output was recorded.
5. Stop a task during reasoning or tool execution. Speed must stop changing, and unfinished tools must show interruption. Tool wait time must not lower the speed of completed model rounds.
6. Expand long arguments and results in light, dark, and narrow-window layouts. Content must wrap, areas must scroll independently, and pixel font sizes, icons, and borders must remain consistent.

### Usage Summaries and Themes

1. Run a task with multiple model rounds and tool calls, then inspect individual records and summaries. Tool-call counts are not model-call counts.
2. Check failed and canceled tasks. Available tokens must be recorded; unavailable data must be shown as unknown rather than zero cost.
3. Check statistics after context compaction (requiring a sufficiently long conversation or controlled configuration). Label compaction usage at the granularity actually available.
4. Restart the service and read the same native session again; usage must not double. After filtering by user, model, and date, paginated details must agree with full summaries.
5. Administrators can view global records; regular users can view only their own. Costs must state the estimation basis rather than appear as actual bills.
6. Login, administration, and usage pages must follow the pixel grid in light, dark, system, and narrow-window layouts. Browser-stored demo data must not be uploaded automatically.
