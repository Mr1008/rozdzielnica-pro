# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Run containers through wslc — except the Supabase stack, which stays on Docker

- **Context**: Any step that starts or manages containers. The exception is the local Supabase stack: `supabase start` / `stop` / `db reset`, and anything that needs it (`npm run test:integration`, `npm run db:types`, `npm run smoke` against a local stack).
- **Problem**: Docker Desktop was replaced by wslc on this machine, so ad-hoc `docker` commands are the wrong runtime. But the Supabase CLI needs a Docker API endpoint, and wslc exposes none. Its dockerd listens only on `/var/run/docker.sock` inside the wslc VM, reached through a private hvsocket channel (checked in the microsoft/WSL source on 2026-10-01). Under wslc, `supabase start` fails with `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`.
- **Rule**: Run ad-hoc containers through wslc, never through docker / Docker Desktop. Keep the local Supabase stack on Docker: if Docker isn't running, ask the user to start it rather than routing Supabase through wslc.
- **Applies to**: all
