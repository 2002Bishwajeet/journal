import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const links = [
  { label: "Source code", href: "https://github.com/2002Bishwajeet/journal" },
  { label: "Report a problem", href: "https://github.com/2002Bishwajeet/journal/issues/new" },
];

export default function AboutSection() {
  const version = `v${__APP_VERSION__} (build ${__APP_BUILD__})`;

  const copyVersion = async () => {
    try {
      await navigator.clipboard.writeText(`Journal ${version} · ${navigator.userAgent}`);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  return (
    <div className="rounded-lg border">
      <div className="flex min-h-14 items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h3 className="text-sm font-semibold">Version</h3>
          <p className="font-mono text-xs text-muted-foreground">{version}</p>
        </div>
        <Button variant="ghost" size="sm" className="min-h-11 min-w-11 md:min-h-0 md:min-w-0" onClick={copyVersion}>
          Copy
        </Button>
      </div>

      <div className="space-y-0.5 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Privacy</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Your notes are stored on this device and synced end-to-end encrypted
          to your own Homebase. On-device AI runs in this browser; model files
          are downloaded once from a public model host. Journal has no
          analytics.
        </p>
      </div>

      <div className="space-y-1 px-4 py-3">
        <h3 className="text-sm font-semibold">Links</h3>
        <ul className="space-y-1">
          {links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
              >
                {link.label}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">(opens in new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
