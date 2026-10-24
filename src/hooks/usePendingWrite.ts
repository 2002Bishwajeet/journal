import { useSyncExternalStore } from "react";
import { acceptWrite, pendingWrites, rejectWrite } from "@/lib/agent/approveWrite";

/** The write the assistant is waiting on the user to accept or reject (#702), and the two answers. */
export function usePendingWrite() {
  const pending = useSyncExternalStore(pendingWrites.subscribe, pendingWrites.current);
  return {
    pending,
    accept: () => pending && void acceptWrite(pending),
    reject: () => pending && rejectWrite(pending),
  };
}
