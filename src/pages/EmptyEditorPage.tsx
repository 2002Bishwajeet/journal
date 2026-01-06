import { useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { FolderOpen, PenLine, PlusCircle } from "lucide-react";
import { motion } from "framer-motion";
import { useNotes } from "@/hooks/useNotes";

export default function EmptyEditorPage() {
  const {
    createNote: { mutateAsync: createNote },
  } = useNotes();
  const navigate = useNavigate();
  const { folderId } = useParams();

  const handleCreateNote = async () => {
    const { docId, folderId: newFolderId } = await createNote(folderId);
    if (docId) {
      navigate(`/${newFolderId}/${docId}`);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full w-full bg-background p-8 relative overflow-hidden">
      {/* Background Decorative Elements */}
      <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none">
        <svg
          className="w-full h-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <path d="M0 100 C 20 0 50 0 100 100 Z" fill="currentColor" />
        </svg>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="z-10 flex flex-col items-center max-w-md text-center"
      >
        <div className="h-24 w-24 bg-primary/5 rounded-3xl flex items-center justify-center mb-6 shadow-sm ring-1 ring-border/50">
          {folderId ? (
            <PenLine className="h-10 w-10 text-primary/80" strokeWidth={1.5} />
          ) : (
            <FolderOpen
              className="h-10 w-10 text-primary/80"
              strokeWidth={1.5}
            />
          )}
        </div>

        <h2 className="text-3xl font-semibold tracking-tight text-foreground mb-3">
          {folderId ? "Start Writing" : "Organize Your Thoughts"}
        </h2>

        <p className="text-muted-foreground text-lg mb-8 leading-relaxed">
          {folderId
            ? "Select a note from the sidebar to continue, or create a brand new note to capture your ideas."
            : "Select a folder to view your notes, or create a new one to get started."}
        </p>

        <Button
          size="lg"
          onClick={handleCreateNote}
          className="h-12 px-8 text-base shadow-lg hover:shadow-xl transition-all duration-300 rounded-full group"
        >
          <PlusCircle className="mr-2 h-5 w-5 group-hover:rotate-90 transition-transform duration-300" />
          Create New Note
        </Button>

        {!folderId && (
          <p className="mt-8 text-xs text-muted-foreground/60 uppercase tracking-widest font-medium">
            Journal v1.0
          </p>
        )}
      </motion.div>
    </div>
  );
}
