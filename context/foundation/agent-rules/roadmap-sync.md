# Roadmap sync

- **Every change to `context/foundation/roadmap.md` must be mirrored to GitHub** with
  `node scripts/roadmap-to-github.mjs --apply` — a regenerated milestone, a status flip, a new
  slice, a new `## Parked` idea, anything. Parked entries become `odłożone` issues; the script
  rewrites only the issue bodies it generated, never a hand-written one. The roadmap file stays the contract the `/10x-plan` → `/10x-implement` →
  `/10x-archive` chain reads by `Change ID`; the issues, milestone and Projects board at
  `users/Mr1008/projects/1` are where the work is actually tracked. Skip the sync and the board
  silently disagrees with the plan. The script is idempotent, reconciles labels in both directions
  and plans by default (no `--apply` = no writes). It needs the **`Mr1008`** gh account;
  use `gh auth switch --user Mr1008` or a one-shot
  `GH_TOKEN=$(gh auth token --user Mr1008)` prefix. **A status never moves backwards:** parallel
  sessions keep their own roadmap copy in other worktrees, so the script lifts each item to the most
  advanced status in any worktree's roadmap, any open `context/changes/<change-id>/` folder, or the
  card's current board column, and prints every lift. A real step back needs `--allow-regress`.
