import { useLocation, useNavigate } from "react-router-dom";

// Back that behaves like a native stack: pop the previous in-app entry when
// there is one, otherwise replace the current entry with the parent screen.
// The initial entry of a session (a deep link, a reload into a fresh tab) has
// the key "default".
export function useBackTo() {
  const navigate = useNavigate();
  const { key } = useLocation();

  return (parent: string) => {
    if (key !== "default") navigate(-1);
    else navigate(parent, { replace: true });
  };
}
