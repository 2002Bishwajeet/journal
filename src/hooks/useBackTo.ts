import { useNavigate } from "react-router-dom";
import { slideNavigate } from "@/lib/navDirection";

// Back that behaves like a native stack: pop the previous in-app entry when
// there is one, otherwise replace the current entry with the parent screen.
// BrowserRouter numbers its entries in history.state.idx; the first entry of a
// session (a deep link, or a reload that session restore redirects with a
// replace) keeps idx 0. On a phone it slides back (#779).
export function useBackTo() {
  const navigate = useNavigate();

  return (parent: string) =>
    slideNavigate("back", () => {
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
      if (idx > 0) navigate(-1);
      else navigate(parent, { replace: true });
    });
}
