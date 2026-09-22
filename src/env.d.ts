declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    /** Resolved once per request in `src/middleware.ts`; `null` means no recognised role. */
    role: import("./lib/roles").UserRole | null;
  }
}
