---
starter_id: 10x-astro-starter
package_manager: npm
project_name: rozdzielnica-pro
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-workers
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

A solo electrician-developer shipping a switchboard-planning MVP in three after-hours weeks, under a hard free-tier constraint for hosting, database and deployment. Astro plus Supabase plus Cloudflare is the recommended default for a JS/TS web app and clears all four agent-friendly gates: TypeScript contracts end to end, conventional layout and routing, heavy presence in training data, and current pinned docs. It also answers the PRD directly — Supabase covers email-and-password auth, the two-role model and the per-electrician data isolation required by the non-functional requirements, without a bespoke auth build; React islands carry the editable cabinet-layout view while the rest of the app stays static and cheap. Cloudflare Pages and the Supabase free tier keep running costs at zero for the MVP, which .NET on Azure F1 could not match. Payments, realtime, AI and background jobs are all out of scope per the PRD non-goals, so nothing in the stack is provisioned for them. CI runs on GitHub Actions with auto-deploy on merge, the shape the starter ships with. One known constraint: the edge runtime cannot render server-side PDFs, so the printable quote uses browser-side print or client-side PDF generation.
