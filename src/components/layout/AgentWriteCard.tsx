import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { usePendingWrite } from "@/hooks/usePendingWrite";
import type { AgentStep } from "@/hooks/useAgentSession";

type WriteState = NonNullable<AgentStep["write"]>["state"];

const STATUS: Record<Exclude<WriteState, "pending">, string> = {
  accepted: "Done",
  rejected: "Rejected",
  notApplied: "Not applied",
};

/**
 * An append to another note or a new note, proposed by the assistant (#702): the markdown as
 * plain text, and Accept / Reject until the user answers. Then it says what happened and links
 * to the note.
 */
export function AgentWriteCard({ step }: { step: AgentStep }) {
  const { pending, accept, reject } = usePendingWrite();
  const { write, summary } = step;
  if (!write) return null;

  return (
    <div role="group" aria-label={`Review the assistant's proposal: ${summary}`} className="mt-2 rounded-md border border-border bg-background p-2 text-xs text-foreground">
      <p className="font-medium break-words">{summary}</p>
      <pre
        tabIndex={0}
        aria-label="Markdown to add"
        className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {write.markdown}
      </pre>
      {write.state === "pending" ? (
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={!pending} onClick={accept}>
            Accept
          </Button>
          <Button size="sm" variant="outline" disabled={!pending} onClick={reject}>
            Reject
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-muted-foreground">
          {STATUS[write.state]}
          {write.note && (
            <>
              {": "}
              <Link to={write.note.href} className="underline underline-offset-2 hover:text-foreground">
                {write.note.title}
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
