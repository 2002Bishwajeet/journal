import ConfirmDialog from '@/components/modals/ConfirmDialog';
import type { PendingDownload } from '@/hooks/useModelDownloadGate';

interface ModelDownloadDialogProps {
  pending: PendingDownload | null;
  onContinue: () => void;
  onCancel: () => void;
}

export default function ModelDownloadDialog({ pending, onContinue, onCancel }: ModelDownloadDialogProps) {
  if (!pending) return null;
  const { model, result } = pending;
  const unsupported = result.verdict === 'unsupported';
  const description = unsupported
    ? result.reasons.join(' ')
    : [
        `${model.name} downloads ${model.downloadSize} and uses ${model.memoryUsage} of memory while it runs.`,
        'Needs WebGPU and a desktop browser.',
        ...result.reasons,
      ].join(' ');

  return (
    <ConfirmDialog
      isOpen
      onClose={onCancel}
      onConfirm={onContinue}
      title={unsupported ? "AI isn't available here" : `Download ${model.name}?`}
      description={description}
      confirmText="Continue"
      cancelText={unsupported ? 'Got it' : 'Cancel'}
      variant="default"
      hideConfirm={unsupported}
    />
  );
}
