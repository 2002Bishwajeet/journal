import ConfirmDialog from './ConfirmDialog';
import { useLeftoverReset } from '@/hooks/useLeftoverReset';

/**
 * The desktop app runs on the plain database an older build left until its changes sync
 * (#1362). When a sync can't send them, this offers the reset, which loses them.
 */
export default function LeftoverResetDialog() {
  const { open, unsynced, dismiss, reset } = useLeftoverReset();
  const one = unsynced === 1;

  return (
    <ConfirmDialog
      isOpen={open}
      onClose={dismiss}
      onConfirm={() => void reset()}
      title="Reset local data and sync again?"
      description={`${unsynced} ${one ? 'change' : 'changes'} on this device couldn't sync. A reset deletes ${one ? 'it' : 'them'} and downloads your synced notes from your Homebase again. Not now keeps ${one ? 'it' : 'them'}, and the app tries to sync again.`}
      confirmText="Reset and sync again"
      cancelText="Not now"
    />
  );
}
