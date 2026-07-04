#!/usr/bin/env bash
# Bumps the version, tags + pushes it here, then updates the image tag in the
# edvbartl-ansible kustomize config and pushes that too (ArgoCD auto-syncs).
#
# Usage:
#   scripts/release.sh              # bump patch (default)
#   scripts/release.sh minor        # bump minor
#   scripts/release.sh major        # bump major
#   scripts/release.sh 0.2.0        # set an explicit version
#   scripts/release.sh -y           # skip the confirmation prompt (any of the above too, e.g. "minor -y")
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ANSIBLE_REPO="$REPO_ROOT/edvbartl-ansible"
STATEFULSET="$ANSIBLE_REPO/kustomize-k8s/bases/paperless-ai-supporter/statefulset.yaml"
CLAUDE_MD="$REPO_ROOT/CLAUDE.md"
IMAGE="ghcr.io/rbartl/paperless-ai-supporter"

ASSUME_YES=false
BUMP="patch"
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=true ;;
    patch|minor|major) BUMP="$arg" ;;
    [0-9]*.[0-9]*.[0-9]*) BUMP="explicit:$arg" ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

cd "$REPO_ROOT"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: $REPO_ROOT has uncommitted changes — commit or stash first." >&2
  exit 1
fi
if [[ -d "$ANSIBLE_REPO" ]] && [[ -n "$(git -C "$ANSIBLE_REPO" status --porcelain)" ]]; then
  echo "error: $ANSIBLE_REPO has uncommitted changes — commit or stash first." >&2
  exit 1
fi

LATEST_TAG="$(git tag --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)"
LATEST_TAG="${LATEST_TAG:-v0.0.0}"
IFS='.' read -r MAJOR MINOR PATCH <<< "${LATEST_TAG#v}"

if [[ "$BUMP" == explicit:* ]]; then
  NEW_VERSION="${BUMP#explicit:}"
else
  case "$BUMP" in
    patch) NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))" ;;
    minor) NEW_VERSION="$MAJOR.$((MINOR + 1)).0" ;;
    major) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
  esac
fi
NEW_TAG="v$NEW_VERSION"

echo "Current: $LATEST_TAG  →  New: $NEW_TAG"
echo "  1. tag + push $NEW_TAG on $(basename "$REPO_ROOT") (triggers GHCR image build)"
echo "  2. bump image to $IMAGE:$NEW_VERSION in edvbartl-ansible, commit + push (ArgoCD syncs)"

if [[ "$ASSUME_YES" != true ]]; then
  read -rp "Proceed? [y/N] " REPLY
  [[ "$REPLY" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
fi

git tag -a "$NEW_TAG" -m "$NEW_TAG"
git push origin "$NEW_TAG"
echo "✓ tagged and pushed $NEW_TAG"

if [[ -d "$ANSIBLE_REPO" ]]; then
  sed -i -E "s#image: $IMAGE:[0-9]+\.[0-9]+\.[0-9]+#image: $IMAGE:$NEW_VERSION#" "$STATEFULSET"
  git -C "$ANSIBLE_REPO" add "$STATEFULSET"
  git -C "$ANSIBLE_REPO" commit -m "paperless-ai-supporter: bump image to $NEW_VERSION"
  git -C "$ANSIBLE_REPO" push origin main
  echo "✓ bumped kustomize image to $NEW_VERSION and pushed"
else
  echo "warning: $ANSIBLE_REPO not found — skipped kustomize bump" >&2
fi

if [[ -f "$CLAUDE_MD" ]]; then
  sed -i -E \
    -e "s#^- Latest tag: v[0-9]+\.[0-9]+\.[0-9]+#- Latest tag: $NEW_TAG#" \
    -e "s#^- Deployed image: $IMAGE:[0-9]+\.[0-9]+\.[0-9]+#- Deployed image: $IMAGE:$NEW_VERSION#" \
    "$CLAUDE_MD"
  echo "✓ updated CLAUDE.md current-state notes"
fi

echo "Done. New version: $NEW_VERSION"
