---
name: penny-git-traceability
description: Enforce Penny traceability for every Git code commit. Use whenever Codex prepares, makes, amends, rebases, cherry-picks, reverts, merges, or documents a code commit or PR: select a matching current Penny task, create one if no exact match exists, add the Penny trailer, and record development evidence in Penny.
---

# Penny Git Traceability

Treat Penny linkage as a release gate for every Git commit that changes source code, tests, schema, build/deploy configuration, or code-adjacent documentation. Do not create, amend, or submit such a commit until it has at least one valid Penny task ID. Do not use `--no-verify` to bypass this policy.

## Resolve the Penny task before staging the commit

1. Extract the concrete change scope from the user request, repository, and diff: repository, component, intended behavior, and affected files.
2. If the user supplied a task ID, call `mcp__penny__get_task_detail` to validate that it exists and matches the work.
3. Otherwise call `mcp__penny__list_my_tasks` with `scope: "assigned_to_me"` and `limit: 100`. Prefer an open or in-progress task whose title, description, and project match the scope.
4. If no exact match exists, repeat with `scope: "related_to_me"`, then use `mcp__penny__search_tasks` with focused repository/component keywords. Inspect a candidate with `get_task_detail`; never choose a task from title similarity alone.
5. Reuse a task only when its objective covers this exact change. Do not reuse a task merely because it has the same repository, a related keyword, or the same requester. Do not use done, archived, or rejected work for new implementation.
6. If there is no exact candidate, create one with `mcp__penny__create_task`. The active request authorizes this creation unless it explicitly asks for a read-only operation. Use a concise title such as `[repo] fix material export timeout`, type `task`, and a description containing the problem, intended result, repository/component, and acceptance criteria. Let Penny default the assignee to the current user. Set project, participants, reviewer, priority, and deadline only when they are known from the matching work; never invent them.
7. If two live tasks are genuinely plausible and choosing one would change ownership or scope, stop and ask the user which task owns the commit. Do not silently create a duplicate just to avoid the decision.

Use the returned `task_id` exactly as Penny supplies it. A single cohesive implementation may use the same task for several commits. Split unrelated work into separate commits and tasks. If one atomic commit necessarily implements multiple tasks, include one `Penny:` trailer for each and create a Penny development record for each task.

## Commit contract

Before committing, inspect the staged scope and run proportionate validation. At minimum run `git diff --cached --check`; record the exact test command and result, or the reason validation was not run.

Put the Penny ID in an exact Git trailer, separated from the subject/body by a blank line:

```text
fix(materials): retain failed logo sites for retry

Penny: recv7o3dyu
```

Rules:

- Use the literal key `Penny`, a colon, one space, and one valid task ID on each trailer line: `Penny: <task-id>`.
- Preserve the trailer when amending, rebasing, cherry-picking, or resolving conflicts. A revert must reference the original task only when it is part of that task's delivery; otherwise resolve or create the rollback task first.
- Add the trailer to every authored merge commit as well. Do not rely on parent commits to make a new merge commit traceable.
- Include the same ID(s) in a PR description when a PR is created, but a PR reference never replaces the commit trailer.
- If a commit is already created without a valid trailer, amend it before pushing whenever history may safely be rewritten. If it has already been shared, do not rewrite shared history without explicit approval; create a corrective linked commit and report the gap.

Immediately after each commit, verify its message with `git log -1 --format=%B` and retrieve the immutable hash with `git rev-parse HEAD`. Do not report the commit as delivered if the expected trailer is absent.

## Record the Penny development evidence

For every task ID in the verified commit, call `mcp__penny__record_task_development` after the commit succeeds. Send:

- `task_id`: the validated or newly created Penny ID.
- `repo`: `origin` remote URL when available; otherwise the repository's absolute path.
- `branch`: the current branch; state a detached-head hash clearly when applicable.
- `commit`: the full verified hash.
- `files_changed`: paths changed by that commit.
- `summary`: concise implementation and delivery summary.
- `test_command` and `test_result`: the actual validation command and outcome, including `Not run: <reason>` when no test was applicable.
- `pr_url`: only after a real PR URL exists.

If the Penny record fails after Git commit succeeds, retain the commit trailer, retry or diagnose the Penny failure, and state that the cross-system trace is incomplete. Do not mark the task delivered, completed, or accepted until the development record is stored. When a PR is created after the initial record, add the PR URL to the task through the available Penny development-record or comment mechanism.

## Scope and evidence rules

- Preserve unrelated staged changes. Never attach a task ID to files that are not part of that task's work.
- Treat task ID, commit hash, repository, branch, changed files, validation, and PR URL as the minimum evidence chain.
- Quote the task ID and commit hash in the handoff. State whether Penny accepted the development record.
- Do not complete, archive, approve, or otherwise change a task's workflow state merely because a commit exists; those are separate user or reviewer decisions.
- For imported or third-party commits that cannot be amended, inspect their existing Penny trailers. If none exists, flag them as historical exceptions instead of falsely claiming compliance.

## Hard enforcement boundary

This skill governs Codex-authored work and makes the evidence path mandatory in each Codex workflow. A skill alone cannot block commits made manually, by another Git client, or by another agent. If the user requires repository-wide technical enforcement, propose a non-destructive `commit-msg` hook rollout that rejects messages without a `Penny: <task-id>` trailer, preserves any existing hook, and is installed only with explicit approval for each repository or a reviewed global hooks configuration.
