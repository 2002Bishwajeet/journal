import { Link } from "react-router-dom";
import { Check, CircleSlash, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePendingWrite } from "@/hooks/usePendingWrite";
import type { AgentStep } from "@/hooks/useAgentSession";

type WriteState = NonNullable<AgentStep["write"]>["state"];

const STATUS: Record<Exclude<WriteState, "pending">, { label: string; Icon: LucideIcon }> = {
  accepted: { label: "Done", Icon: Check },
  rejected: { label: "Rejected", Icon: X },
  notApplied: { label: "Not applied", Icon: CircleSlash },
};

/** Same look as the in-note bar's buttons (AgentEditPreview.ts). */
const BUTTON = "pointer-coarse:h-11 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const LINK = "rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The note a proposal writes to, from its summary (proposeWrite.ts): "Append to 'Packing list'" or
 * "Create note 'Ideas' in Main". The card shows the title on a line of its own.
 */
function target(summary: string): { action: string; title: string } | null {
  const append = /^Append to '(.*)'$/s.exec(summary);
  if (append) return { action: "Append to", title: append[1] };
  const create = /^Create note '(.*)' in (.*)$/s.exec(summary);
  return create ? { action: `Create note in ${create[2]}`, title: create[1] } : null;
}

/**
 * An append to another note or a new note, proposed by the assistant (#702): the markdown as
 * plain text, and Accept / Reject until the user answers. Then it says what happened and links
 * to the note.
 */
export function AgentWriteCard({ step }: { step: AgentStep }) {
  const { pending, accept, reject } = usePendingWrite();
  const { write, summary } = step;
  if (!write) return null;
  const to = summary ? target(summary) : null;
  const status = write.state !== "pending" && STATUS[write.state];

  return (
    <div role="group" aria-label={`Review the assistant's proposal: ${summary}`} className="rounded-lg border border-border bg-popover text-popover-foreground shadow-sm">
      <div className="px-3 pt-2.5">
        {to ? (
          <>
            <p className="text-xs text-muted-foreground">{to.action}</p>
            <p className="font-medium break-words">{to.title}</p>
          </>
        ) : (
          <p className="font-medium break-words">{summary}</p>
        )}
      </div>
      <pre
        tabIndex={0}
        aria-label="Markdown to add"
        className="mx-3 mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2 font-sans text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {write.markdown}
      </pre>
      {status ? (
        <p className="flex items-center gap-1.5 px-3 py-2.5 text-xs text-muted-foreground">
          <status.Icon aria-hidden="true" className={status.Icon === Check ? "size-3.5 shrink-0 text-success" : "size-3.5 shrink-0"} />
          <span className="min-w-0 break-words">
            {status.label}
            {write.note && (
              <>
                {": "}
                <Link to={write.note.href} className={LINK}>
                  {write.note.title}
                </Link>
              </>
            )}
          </span>
        </p>
      ) : (
        <div className="flex justify-end gap-2 p-3">
          <Button size="sm" className={BUTTON} disabled={!pending} onClick={accept}>
            Accept
          </Button>
          <Button size="sm" variant="outline" className={BUTTON} disabled={!pending} onClick={reject}>
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
