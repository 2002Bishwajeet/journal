import { lazy } from "react";

// ponytail: one shared lazy wrapper so App's route and JournalLayout's tab
// keep-alive resolve the SAME chunk. EditorPage pulls the whole TipTap stack
// (~750 KB raw), which must not sit on the boot path — /welcome, /share/* and
// /auth/finalize never render an editor at all.
export default lazy(() => import("@/pages/EditorPage"));

/** Warm the editor chunk off the critical path. */
export function prefetchEditorPage() {
  import("@/pages/EditorPage");
}
