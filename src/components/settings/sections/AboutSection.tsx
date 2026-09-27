import logo from "@/assets/logo_withoutbg.png";
import { Database, Cpu, Lock, Shield, Keyboard } from "lucide-react";
import { SectionHeader } from "../SectionHeader";

export default function AboutSection({
  onOpenShortcuts,
}: {
  onOpenShortcuts: () => void;
}) {
  return (
    <div className="p-8 space-y-10">
      {/* Brand */}
      <div className="space-y-6">
        <div className="text-center py-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/5 mb-4">
            <img src={logo} alt="Journal" className="h-10 w-10 object-contain" />
          </div>
          <h2
            className="text-3xl tracking-tight"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Journal
          </h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto leading-relaxed">
            A local-first, end-to-end encrypted personal journal with on-device
            AI.
          </p>
          <span
            className="inline-block mt-3 text-[11px] font-mono text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-md"
          >
            v{__APP_VERSION__}
          </span>
          <button
            onClick={onOpenShortcuts}
            className="flex items-center gap-2 mx-auto mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Keyboard className="h-4 w-4" />
            View keyboard shortcuts
          </button>
        </div>
      </div>

      {/* Decorative divider */}
      <div className="flex items-center gap-4 px-8">
        <div className="flex-1 h-px bg-border/60" />
        <div
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: "#B8860B" }}
        />
        <div className="flex-1 h-px bg-border/60" />
      </div>

      {/* Privacy */}
      <div className="space-y-6">
        <SectionHeader subtitle="Built with privacy as a foundation">
          Privacy Promise
        </SectionHeader>
        <div
          className="rounded-xl p-5 relative overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, rgba(16, 185, 129, 0.04) 0%, rgba(16, 185, 129, 0.01) 100%)",
            border: "1px solid rgba(16, 185, 129, 0.15)",
          }}
        >
          <ul className="space-y-3">
            {[
              {
                icon: Database,
                text: "All notes stored locally in your browser",
              },
              {
                icon: Cpu,
                text: "AI runs entirely on-device via WebLLM",
              },
              {
                icon: Lock,
                text: "Sync traffic is end-to-end encrypted",
              },
              {
                icon: Shield,
                text: "No data sent to external servers",
              },
            ].map((item, i) => (
              <li key={i} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-emerald-100/80 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                  <item.icon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <span className="text-sm text-emerald-800/80 dark:text-emerald-400/70">
                  {item.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
