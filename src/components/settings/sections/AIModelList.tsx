import { cn } from "@/lib/utils";
import { Cpu, Download, HardDrive, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import { AVAILABLE_MODELS } from "@/lib/webllm";
import { staggerItem } from "../motion";

export default function AIModelList({
  selectedModelId,
  onSelect,
}: {
  selectedModelId: string;
  onSelect: (id: string) => Promise<void>;
}) {
  return (
    <div className="space-y-2.5">
      {AVAILABLE_MODELS.map((model, i) => (
        <motion.button
          key={model.id}
          variants={staggerItem}
          custom={i}
          onClick={() => onSelect(model.id)}
          className={cn(
            "w-full text-left p-4 rounded-xl border transition-all duration-200 group",
            selectedModelId === model.id
              ? "border-[#B8860B]/30 bg-[#B8860B]/[0.04]"
              : "border-border/60 bg-card hover:border-border hover:shadow-sm"
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                selectedModelId === model.id
                  ? "bg-[#B8860B]/10"
                  : "bg-muted/60 group-hover:bg-muted"
              )}
            >
              <Cpu
                className={cn(
                  "h-4 w-4",
                  selectedModelId === model.id
                    ? "text-[#B8860B]"
                    : "text-muted-foreground"
                )}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">
                  {model.name}
                </span>
                <span className="text-[11px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-md font-mono">
                  {model.parameterCount}
                </span>
                {model.recommended && (
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      background: "rgba(184, 134, 11, 0.1)",
                      color: "#B8860B",
                    }}
                  >
                    Recommended
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {model.description}
              </p>
              {/* Resource indicators */}
              <div className="flex items-center gap-4 mt-2.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Download className="h-3 w-3" />
                  {model.downloadSize}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <HardDrive className="h-3 w-3" />
                  {model.memoryUsage}
                </div>
              </div>
            </div>
            {selectedModelId === model.id && (
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                <CheckCircle2 className="h-5 w-5 text-[#B8860B] shrink-0 mt-1" />
              </motion.div>
            )}
          </div>
        </motion.button>
      ))}
    </div>
  );
}
