import { cn } from "@/lib/utils";
import { Cpu, Download, HardDrive, CheckCircle2 } from "lucide-react";
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
    <div role="radiogroup" aria-label="Model" aria-disabled={disabled} className="space-y-2.5">
      {AVAILABLE_MODELS.map((model) => {
        const isSelected = selectedModelId === model.id;
        return (
          <label
            key={model.id}
            className={cn(
              "relative block w-full cursor-pointer text-left p-4 rounded-xl border border-border/60 bg-card transition-colors group has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-6 has-[:focus-visible]:outline-ring",
              isSelected
                ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                : "hover:border-border hover:shadow-sm",
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
              <div
                className={cn(
                  "mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                  isSelected ? "bg-primary/10" : "bg-muted/60 group-hover:bg-muted"
                )}
              >
                <Cpu
                  className={cn(
                    "h-4 w-4",
                    isSelected ? "text-primary" : "text-muted-foreground"
                  )}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{model.name}</span>
                  <span className="text-xs text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-md font-mono">
                    {model.parameterCount}
                  </span>
                  {model.recommended && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {model.description}
                </p>
                {/* Resource indicators */}
                <div className="flex items-center gap-4 mt-2.5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Download className="h-3 w-3" />
                    {model.downloadSize}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <HardDrive className="h-3 w-3" />
                    {model.memoryUsage}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  {model.capabilities.map(capabilityLabel).join(" · ")}
                </p>
              </div>
              {isSelected && (
                <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-1" />
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
}
