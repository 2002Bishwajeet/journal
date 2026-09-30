import ConfirmDialog from './ConfirmDialog';

interface SignOutConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Local changes not yet synced — sign-out wipes this device's data, so they'd be lost. */
  pendingTotal: number;
}

/** Shared by Settings → Account and the sidebar so both warn with the same words. */
export default function SignOutConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  pendingTotal,
}: SignOutConfirmDialogProps) {
  const one = pendingTotal === 1;
  const description =
    pendingTotal > 0
      ? `${pendingTotal} ${one ? 'change' : 'changes'} on this device ${one ? "hasn't" : "haven't"} synced yet and will be lost. Sync first, or sign out anyway.`
      : "Your notes stay safe in your Homebase. This device's local copy will be removed and re-downloaded next time you sign in.";

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Sign out?"
      description={description}
      confirmText="Sign out"
    />
  );
}
