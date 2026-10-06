import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { encodeMcpLoginCode } from "@/lib/mcpLoginCode";

export default function McpCodePage() {
  const [searchParams] = useSearchParams();
  const [copied, setCopied] = useState(false);

  const identity = searchParams.get("identity");
  const publicKey = searchParams.get("public_key");
  const salt = searchParams.get("salt");

  const code =
    identity && publicKey && salt
      ? encodeMcpLoginCode({ identity, public_key: publicKey, salt })
      : null;

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard blocked: the code is still selectable on screen.
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-xl flex flex-col gap-4">
        {code ? (
          <>
            <h1 className="text-lg font-medium text-foreground">
              Your login code
            </h1>
            <pre
              data-testid="mcp-login-code"
              className="font-mono text-xs bg-muted text-foreground rounded-md p-3 whitespace-pre-wrap break-all select-all"
            >
              {code}
            </pre>
            <div>
              <Button onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Paste this code into the terminal where{" "}
              <code className="font-mono">journal-mcp login --no-browser</code>{" "}
              is waiting.
            </p>
          </>
        ) : (
          <div role="alert">
            <h1 className="text-lg font-medium text-foreground mb-1">
              Missing login details
            </h1>
            <p className="text-sm text-muted-foreground">
              This page needs identity, public_key and salt in the address.
              Start again with{" "}
              <code className="font-mono">journal-mcp login --no-browser</code>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
