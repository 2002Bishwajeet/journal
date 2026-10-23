import { useRef, useState } from 'react';
import { useDeviceType } from './useDeviceType';
import { getModelInfo, isModelCached, type ModelInfo } from '@/lib/webllm';
import { checkRequirements, probeDevice, type RequirementsResult } from '@/lib/webllm/requirements';

export interface PendingDownload {
    model: ModelInfo;
    result: RequirementsResult;
}

/**
 * Gate in front of every model download. `confirmDownload(modelId)` resolves
 * true when the model is already cached or the user chose Continue, and false
 * when the device is unsupported or the user cancelled. Render
 * `<ModelDownloadDialog {...dialogProps} />` next to the caller.
 */
export function useModelDownloadGate() {
    const isMobile = useDeviceType() === 'mobile';
    const [pending, setPending] = useState<PendingDownload | null>(null);
    const settleRef = useRef<((proceed: boolean) => void) | null>(null);

    const settle = (proceed: boolean) => {
        settleRef.current?.(proceed);
        settleRef.current = null;
        setPending(null);
    };

    const confirmDownload = async (modelId: string): Promise<boolean> => {
        const model = getModelInfo(modelId);
        if (!model) return false;
        const result = checkRequirements(await probeDevice(isMobile), model);
        if (result.verdict !== 'unsupported' && (await isModelCached(result.modelId))) return true;
        settleRef.current?.(false);
        return new Promise<boolean>((resolve) => {
            settleRef.current = resolve;
            setPending({ model, result });
        });
    };

    return {
        confirmDownload,
        dialogProps: { pending, onContinue: () => settle(true), onCancel: () => settle(false) },
    };
}
