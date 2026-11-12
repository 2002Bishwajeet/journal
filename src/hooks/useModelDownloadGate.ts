import { useRef, useState } from 'react';
import { useDeviceType } from './useDeviceType';
import { getModelInfo, isModelCached, type ModelInfo } from '@/lib/webllm';
import { checkRequirements, probeDevice, type RequirementsResult } from '@/lib/webllm/requirements';
import { checkIOSRequirements, crashedModels, isIOSApp, probeIOS } from '@/lib/webllm/ios';

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
        // A model outside the catalogue (one the AI eval loaded, #1022) runs only once it is downloaded.
        if (!model) return isModelCached(modelId);
        const result = isIOSApp()
            ? checkIOSRequirements(await probeIOS(), model, crashedModels(), (navigator as { connection?: { type?: string } }).connection)
            : checkRequirements(await probeDevice(isMobile), model);
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
