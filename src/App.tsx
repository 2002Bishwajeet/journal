import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  EditorPage,
  LandingPage,
  AuthFinalizePage,
  EmptyEditorPage,
  SharePage,
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <BrowserRouter>
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
              </Route>

              {/* Public routes */}
              <Route path="/welcome" element={<LandingPage />} />
              <Route path="/auth/finalize" element={<AuthFinalizePage />} />
              <Route path="/share/:identity/:noteId" element={<SharePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </DotYouClientProvider>
        </BrowserRouter>
        <Toaster />
      </ErrorBoundary>
    </QueryClientProvider>
  );
}

export default App;
