import { cn } from "@/lib/utils";
import { Download, HardDrive, CheckCircle2 } from "lucide-react";
import { AVAILABLE_MODELS } from "@/lib/webllm";

const capabilityLabel = (capability: string) =>
  capability[0].toUpperCase() + capability.slice(1);

export default function AIModelList({
  selectedModelId,
  onSelect,
  disabled,
}: {
  selectedModelId: string;
  onSelect: (id: string) => Promise<void>;
  disabled: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Model" aria-disabled={disabled} className="space-y-3">
      {AVAILABLE_MODELS.map((model) => {
        const isSelected = selectedModelId === model.id;
        return (
          <label
            key={model.id}
            className={cn(
              "relative block w-full cursor-pointer rounded-xl border bg-card p-4 text-left transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-6 has-[:focus-visible]:outline-ring",
              isSelected
                ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                : "hover:border-muted-foreground",
              disabled && "cursor-not-allowed opacity-60"
            )}
          >
            <input
              type="radio"
              name="model"
              value={model.id}
              checked={isSelected}
              disabled={disabled}
              onChange={() => onSelect(model.id)}
              className="sr-only"
            />
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm leading-5 font-medium">{model.name}</span>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    {model.parameterCount}
                  </span>
                  {model.recommended && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {model.description}
                </p>
                {/* Resource indicators */}
                <div className="mt-2.5 flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
                  <div className="flex items-center gap-1.5">
                    <Download className="h-3 w-3" aria-hidden="true" />
                    {model.downloadSize}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <HardDrive className="h-3 w-3" aria-hidden="true" />
                    {model.memoryUsage}
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {model.capabilities.map(capabilityLabel).join(" · ")}
                </p>
              </div>
              {isSelected && (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
}
