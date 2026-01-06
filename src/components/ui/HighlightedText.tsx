import { cn } from "@/lib/utils";

interface HighlightedTextProps {
  /** Text containing <mark> tags for highlighting */
  text: string;
  className?: string;
}

/**
 * Renders text with <mark> tags converted to styled highlight spans.
 * Used to display search results with matched terms highlighted.
 */
export function HighlightedText({ text, className }: HighlightedTextProps) {
  // Split on <mark>...</mark> patterns, keeping the delimiters
  const parts = text.split(/(<mark>.*?<\/mark>)/g);
  
  return (
    <span className={cn("", className)}>
      {parts.map((part, i) => {
        if (part.startsWith('<mark>') && part.endsWith('</mark>')) {
          // Extract the content between <mark> and </mark>
          const content = part.slice(6, -7);
          return (
            <mark 
              key={i} 
              className="bg-yellow-200 dark:bg-yellow-700/60 text-foreground rounded px-0.5 font-medium"
            >
              {content}
            </mark>
          );
        }
        return part;
      })}
    </span>
  );
}

export default HighlightedText;
