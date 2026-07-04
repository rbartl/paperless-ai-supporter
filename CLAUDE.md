# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# Project-specific: Deployment / Cloud Notes

This app is deployed to a k3s cluster via ArgoCD, managed from a separate
Gitea-hosted repo checked out locally at `./edvbartl-ansible` (its own git
repo, not a submodule; ignored by this repo's `.gitignore`).

## Release process

1. Tag a new version on **this** repo and push the tag:
   ```
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```
   Pushing a `v*` tag triggers `.github/workflows/docker.yml`, which builds
   and pushes `ghcr.io/rbartl/paperless-ai-supporter:X.Y.Z` (multi-arch,
   amd64+arm64) to GHCR.

2. Bump the image tag in the kustomize base:
   `edvbartl-ansible/kustomize-k8s/bases/paperless-ai-supporter/statefulset.yaml`
   → update the `image: ghcr.io/rbartl/paperless-ai-supporter:X.Y.Z` line.

3. Commit and push in `edvbartl-ansible` (remote:
   `ssh://git@gitea.edv-bartl.at:7999/edvbartl/edvbartl-ansible.git`, branch
   `main`). ArgoCD syncs from Gitea automatically — no `kubectl apply` needed.

`scripts/release.sh [patch|minor|major|X.Y.Z] [-y]` automates steps 1–3
(bumps, tags, pushes both repos). It refuses to run if either repo has
uncommitted changes. Note: it only pushes the new tag on this repo, not the
`main` branch — push any pending commits to `origin main` yourself first.

## Key paths in edvbartl-ansible

- Base: `kustomize-k8s/bases/paperless-ai-supporter/`
- Overlay (prod2024): `kustomize-k8s/overlays/prod2024/paperless-ai-supporter/`
- ArgoCD app def: `kustomize-k8s/overlays/prod2024/argomainapp/apps/paperless-ai-supporter.yaml`
- More general conventions for the whole cluster repo: `edvbartl-ansible/kustomize-k8s/CLAUDE.md`

## Current state (as of last bump)

- Latest tag: v0.1.8
- Deployed image: ghcr.io/rbartl/paperless-ai-supporter:0.1.8
- `PAPERLESS_URL` (internal, used by the API client) and `PAPERLESS_PUBLIC_URL`
  (external, used for user-facing links in the web UI, defaults to
  `PAPERLESS_URL` if unset) are separate env vars. Set in the kustomize
  statefulset to `http://paperless.paperless:8080` and
  `https://pl.edv-bartl.at/` respectively.

## Other tools

For easy/small tasks, prefer delegating to `cursor-agent` (Cursor CLI, already
installed) instead of doing them yourself — it saves Claude tokens. Run it
non-interactively with a prompt and auto-accept all actions:

```
cursor-agent -p --force "<prompt>"
```

(`-p`/`--print` runs non-interactively; `-f`/`--force` — alias `--yolo` —
accepts all tool calls without prompting.)

### Complexity score → what to do

Before acting on any task, score it 0–100 on complexity/risk, then follow the
matching threshold. Add points for whatever applies:

| Factor | Points |
|---|---|
| Requirements are ambiguous / need a judgment call | +30 |
| Touches more than ~3 files, or a multi-step refactor | +20 |
| High blast radius (production data, money, security, shared/public API) | +25 |
| No existing pattern in the repo to copy — genuinely novel | +15 |
| Exact commands/diff can't be fully spelled out in the prompt up front | +20 |
| Hard/impossible to reverse if wrong (force-push, prod deploy, data migration) | +15 |

Add them up (cap at 100) and act on the total:

- **0–30 → delegate to cursor-agent, don't even monitor it.** Fire-and-forget:
  redirect/discard its output, don't read it, don't re-verify with `git
  status`/`git log`/diffing afterward. Reading trivial output defeats the
  point of delegating (saving tokens).
  Examples: `git commit`/`tag`/`push` with exact message and refs given,
  bumping a version string in one known file, renaming a var with a
  find/replace.
- **31–70 → delegate to cursor-agent, but verify after.** Give it a precise,
  scoped prompt (exact files, what NOT to touch), then read the resulting
  diff/output and confirm it matches what was asked.
  Examples: adding a config field and threading it through a few call sites,
  a small well-scoped UI tweak, read-only investigation of "where is X" /
  "how does Y work".
- **71–100 → do it yourself, don't delegate.** Judgment-heavy, high-risk, or
  too ambiguous to fully specify — a subagent or cursor-agent would just
  produce something that needs redoing.
  Examples: architecture decisions, anything needing back-and-forth
  clarification with the user first, production-data-affecting changes
  without a clear rollback.

### Further optimizations

- **Background it**: for anything whose result isn't needed immediately, run
  `cursor-agent` as a backgrounded shell command instead of blocking on it —
  fire-and-forget.
- **`--continue` / `--resume`**: chain related small tasks in one session
  instead of re-explaining full repo context in every prompt — cuts
  prompt-writing overhead across a multi-step task.
- **`--mode ask`** (read-only): for investigation questions ("where is X
  defined", "how does Y work") instead of burning several Grep/Read calls —
  only the final answer needs to be read, not the search trail.
- **`-w` / `--worktree`**: for edits with any blast radius, isolate the
  change in a throwaway worktree so working-tree state doesn't need to be
  checked as carefully before handing off or after landing.
- **`--model`**: no need to set this — the default model is `composer`,
  which is cheap/generous enough that limits haven't been an issue. Leave it
  unset unless a task specifically needs a stronger model.
