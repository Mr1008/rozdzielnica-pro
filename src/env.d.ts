declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    /** Resolved once per request in `src/middleware.ts`; `null` means no recognised role. */
    role: import("./lib/roles").UserRole | null;
    /** The viewer's IANA time zone, resolved once per request in `src/middleware.ts`; never empty. */
    timeZone: string;
  }
}
