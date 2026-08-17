# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes, merged with project-specific notes below. Bias toward caution over speed; use judgment on trivial tasks.

## General guidelines

1. **Think before coding** — state assumptions, present alternatives if the request is ambiguous, push back if a simpler approach exists, stop and ask if genuinely unclear.
2. **Simplicity first** — minimum code for the ask. No speculative abstractions, config, or error handling for impossible cases. If it could be half the size, rewrite it.
3. **Surgical changes** — touch only what the task requires. Don't refactor/reformat adjacent code. Remove only imports/vars *your* change orphaned; mention (don't delete) pre-existing dead code. Every changed line should trace to the request.
4. **Goal-driven execution** — turn tasks into verifiable goals ("write a failing test, then make it pass") and loop until met. State a brief step→verify plan for multi-step work.

Working well if: diffs have no unnecessary changes, few overcomplication rewrites, clarifying questions come before implementation not after mistakes.

---

# Project: paperless-ai-supporter deployment

Deployed to a k3s cluster via ArgoCD, from a separate Gitea repo checked out at `./edvbartl-ansible` (own git repo, gitignored here).

## Release process

1. `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z` — a `v*` tag push triggers `.github/workflows/docker.yml`, building/pushing `ghcr.io/rbartl/paperless-ai-supporter:X.Y.Z` to GHCR.
2. Bump `image:` in `edvbartl-ansible/kustomize-k8s/bases/paperless-ai-supporter/statefulset.yaml`.
3. Commit + push in `edvbartl-ansible` (`ssh://git@gitea.edv-bartl.at:7999/edvbartl/edvbartl-ansible.git`, branch `main`) — ArgoCD auto-syncs, no `kubectl apply`.

`scripts/release.sh [patch|minor|major|X.Y.Z] [-y]` automates all 3 steps; refuses to run with uncommitted changes in either repo. It only pushes the tag on this repo, not `main` — push pending commits yourself first.

Live prompt templates (`prompts/*.txt`, e.g. extraction rules/JSON schema) are edited at `/prompts` in the running app and persisted on the PVC — no deploy needed, but they're a separate thing from app code and easy to forget when adding a new extracted field (it must be added to the live prompt too, not just the code).

Key paths in edvbartl-ansible: base `kustomize-k8s/bases/paperless-ai-supporter/`, overlay `kustomize-k8s/overlays/prod2024/paperless-ai-supporter/`, ArgoCD app def `kustomize-k8s/overlays/prod2024/argomainapp/apps/paperless-ai-supporter.yaml`, cluster-wide conventions in `edvbartl-ansible/kustomize-k8s/CLAUDE.md`.

Current: tag v0.1.17, image 0.1.17. `PAPERLESS_URL` (internal API client) and `PAPERLESS_PUBLIC_URL` (external, user-facing links, defaults to `PAPERLESS_URL`) are separate env vars — set to `http://paperless.paperless:8080` and `https://pl.edv-bartl.at/`.

## Delegating to cursor-agent

For easy/small tasks, delegate to `cursor-agent -p --force "<prompt>"` instead of doing them directly — saves Claude tokens (`-p` = non-interactive, `-f`/`--force` = auto-accept all tool calls).

**Score the task 0–100, then act:**

| Factor | Points |
|---|---|
| Ambiguous requirements / needs a judgment call | +30 |
| Touches >3 files or a multi-step refactor | +20 |
| High blast radius (prod data, money, security, shared API) | +25 |
| No existing pattern to copy — genuinely novel | +15 |
| Can't fully spell out the exact diff upfront | +20 |
| Hard to reverse if wrong | +15 |

- **0–30 — delegate, don't monitor.** Fire-and-forget: discard output, skip re-verifying. E.g. git commit/tag/push with exact message+refs given, a version bump in one known file.
- **31–70 — delegate, verify after.** Precise scoped prompt (exact files, what NOT to touch), then read the diff/output. E.g. adding a config field threaded through a few call sites, a small UI tweak, read-only investigation.
- **71–100 — do it yourself.** Architecture decisions, anything needing back-and-forth clarification, high-risk changes without a clear rollback.

Other levers: background it when the result isn't needed immediately; `--continue`/`--resume` to chain related tasks in one session instead of re-explaining context; `--mode ask` for read-only investigation; `-w`/`--worktree` to isolate risky edits; skip `--model` — default (`composer`) is cheap/generous enough.
