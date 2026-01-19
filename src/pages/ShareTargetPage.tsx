import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useNotes } from "@/hooks/useNotes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAIN_FOLDER_ID } from "@/lib/homebase";

export default function ShareTargetPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { createNoteWithContent } = useNotes();

  // Lazy initialization of state
  const [title, setTitle] = useState(
    () => searchParams.get("title") || "Shared Note",
  );
  const [content, setContent] = useState(() => {
    const text = searchParams.get("text") || "";
    const url = searchParams.get("url") || "";
    if (text && url) return `${text}\n\n${url}`;
    return text || url;
  });

  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Use the dedicated hook for creation + content + yjs
      const { docId } = await createNoteWithContent.mutateAsync({
        title,
        content,
        folderId: MAIN_FOLDER_ID,
      });

      if (docId) {
        navigate(`/${MAIN_FOLDER_ID}/${docId}`, {
          replace: true,
          viewTransition: true,
        });
      }
    } catch (error) {
      console.error("Failed to save shared note:", error);
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col p-4 md:p-8 max-w-2xl mx-auto pt-[env(safe-area-inset-top)]">
      <div className="flex items-center justify-between mb-8 mt-4">
        <h1 className="text-2xl font-bold tracking-tight">Save to Journal</h1>
        <Button variant="ghost" size="icon" onClick={handleCancel}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="space-y-6 flex-1">
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Note Title"
            className="text-lg font-medium"
          />
        </div>

        <div className="space-y-2 flex-1 flex flex-col min-h-50">
          <Label htmlFor="content">Content</Label>
          <textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className={cn(
              "flex min-h-50 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
              "resize-none flex-1 font-mono leading-relaxed",
            )}
            placeholder="Write your note..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4 pb-[env(safe-area-inset-bottom)]">
          <Button
            variant="outline"
            size="lg"
            onClick={handleCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button size="lg" onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Note
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
