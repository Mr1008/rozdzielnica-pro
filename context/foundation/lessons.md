# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Run containers through wslc — except the Supabase stack, which runs on Podman

- **Context**: Any step that starts or manages containers. The exception is the local Supabase stack (see "Run the local Supabase stack on Podman, not Docker" below).
- **Problem**: Docker Desktop was replaced by wslc on this machine, so ad-hoc `docker` commands are the wrong runtime. But the Supabase CLI needs a Docker API endpoint, and wslc exposes none. Its dockerd listens only on `/var/run/docker.sock` inside the wslc VM, reached through a private hvsocket channel (checked in the microsoft/WSL source on 2026-10-01). Under wslc, `supabase start` fails with `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`.
- **Rule**: Run ad-hoc containers through wslc, never through docker / Docker Desktop. Never route the Supabase stack through wslc; it runs on Podman.
- **Applies to**: all

## Run the local Supabase stack on Podman, not Docker

- **Context**: Any step that starts or uses the local Supabase stack: `supabase start` / `stop` / `db reset`, `npm run db:types`, `npm run test:integration`, and `npm run smoke` against a local stack. This includes runs from a fresh worktree.
- **Problem**: Docker isn't installed on this machine, so `supabase start` can't find a Docker API and fails. In a new worktree it also fails with `statfs …/supabase/snippets: no such file or directory`, because Studio bind-mounts that folder and git doesn't track empty directories.
- **Rule**: Point the Supabase CLI at Podman's API pipe with `DOCKER_HOST=npipe:////./pipe/podman-machine-default` (the `podman-machine-default` machine must be running). Never ask for Docker or install it. In a new worktree, create an empty `supabase/snippets` folder before the first `supabase start`.
- **Applies to**: all
