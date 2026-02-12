import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { get, set, del } from "idb-keyval";
import {
  EditorPage,
  LandingPage,
  AuthFinalizePage,
  EmptyEditorPage,
  SharePage,
  ShareTargetPage,
  ChatBotPage,
} from "@/pages";
import JournalLayout from "@/layouts/JournalLayout";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  DotYouClientProvider,
  AuthGuard,
  RootRedirect,
} from "@/components/auth";
import { SyncProvider } from "@/components/providers/SyncProvider";
import { OnlineProvider } from "@/components/providers/OnlineProvider";
import { UpdatePrompt } from "@/components/pwa/UpdatePrompt";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 60 * 24, // 24 hours - keep in cache for offline
      refetchOnWindowFocus: false,
    },
  },
});

// IndexedDB persister for offline support
const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (key: string) => await get(key),
    setItem: async (key: string, value: string) => await set(key, value),
    removeItem: async (key: string) => await del(key),
  },
  key: "journal-query-cache",
});

function App() {
  return (
    <PersistQueryClientProvider 
      client={queryClient} 
      persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 }}
    >
      <ErrorBoundary>
        <BrowserRouter>
          <OnlineProvider>
            <DotYouClientProvider>
              <Routes>
                {/* Protected route */}
                <Route
                  element={
                    <AuthGuard>
                      <SyncProvider>
                        <JournalLayout />
                      </SyncProvider>
                    </AuthGuard>
                  }
                >
                  <Route index element={<RootRedirect />} />
                  <Route path="/:folderId" element={<EmptyEditorPage />} />
                  <Route path="/:folderId/:noteId" element={<EditorPage />} />
                  <Route path="/:folderId/:noteId/chat" element={<ChatBotPage />} />
                </Route>

                {/* Secure Share Target Route - requires auth to save */}
                <Route
                  path="/share-target"
                  element={
                    <AuthGuard>
                      <SyncProvider>
                        <ShareTargetPage />
                      </SyncProvider>
                    </AuthGuard>
                  }
                />

                {/* Public routes */}
                <Route path="/welcome" element={<LandingPage />} />
                <Route path="/auth/finalize" element={<AuthFinalizePage />} />
                <Route path="/share/:identity/:noteId" element={<SharePage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </DotYouClientProvider>
          </OnlineProvider>
        </BrowserRouter>

        <Toaster />
        <UpdatePrompt />
      </ErrorBoundary>
    </PersistQueryClientProvider>
  );
}

export default App;
