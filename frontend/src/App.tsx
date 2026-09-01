import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import { ConfigProvider, Spin, theme } from 'antd';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ConfirmationProvider } from './context/ConfirmContext';

// Route-level code splitting: each page ships in its own chunk, loaded on demand.
const LoginPage = lazy(() => import('./pages/LoginPage'));
const AcceptInvitePage = lazy(() => import('./pages/AcceptInvitePage'));
const AccessConsolePage = lazy(() => import('./pages/AccessConsolePage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const EnvironmentsPage = lazy(() => import('./pages/EnvironmentsPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const ProjectPage = lazy(() => import('./pages/ProjectPage'));
const RunsPage = lazy(() => import('./pages/RunsPage'));
const SchedulesPage = lazy(() => import('./pages/SchedulesPage'));
const ScheduleHistoryPage = lazy(() => import('./pages/ScheduleHistoryPage'));
const SuitesPage = lazy(() => import('./pages/SuitesPage'));
const TestEditorPage = lazy(() => import('./pages/TestEditorPage'));
const RunResultPage = lazy(() => import('./pages/RunResultPage'));
const RunBatchResultPage = lazy(() => import('./pages/RunBatchResultPage'));

function PageFallback() {
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Spin size="large" /></div>;
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { token, ready } = useAuth();

  if (!ready) {
    return null;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// Access console is open to superadmins (Groups/Users) and to teams:manage holders (Teams tab).
// The page itself hides the superadmin-only tabs from non-superadmins.
function AccessRoute({ children }: { children: ReactNode }) {
  const { isSuperadmin, canManageTeams, ready } = useAuth();

  if (!ready) {
    return null;
  }

  if (!isSuperadmin && !canManageTeams) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm }}>
        <ConfirmationProvider>
        <BrowserRouter>
          <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/accept-invite" element={<AcceptInvitePage />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <Routes>
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/runs" element={<RunsPage />} />
                    <Route path="/projects" element={<ProjectsPage />} />
                    <Route path="/projects/:projectId" element={<ProjectPage />} />
                    <Route path="/projects/:projectId/checks" element={<ProjectPage />} />
                    <Route path="/projects/:projectId/overview" element={<ProjectPage />} />
                    <Route path="/projects/:projectId/runs" element={<ProjectPage />} />
                    <Route path="/projects/:projectId/settings" element={<ProjectPage />} />
                    <Route path="/projects/:projectId/environments" element={<EnvironmentsPage />} />
                    <Route path="/projects/:projectId/notifications" element={<NotificationsPage />} />
                    <Route path="/projects/:projectId/suites" element={<SuitesPage />} />
                    <Route path="/projects/:projectId/schedules" element={<SchedulesPage />} />
                    <Route path="/schedules/:scheduleId/history" element={<ScheduleHistoryPage />} />
                    <Route path="/projects/:projectId/tests/new" element={<TestEditorPage />} />
                    <Route path="/tests/:testId/edit" element={<TestEditorPage />} />
                    <Route path="/runs/:runId" element={<RunResultPage />} />
                    <Route path="/run-batches/:batchId" element={<RunBatchResultPage />} />
                    <Route path="/access" element={<AccessRoute><AccessConsolePage /></AccessRoute>} />
                  </Routes>
                </ProtectedRoute>
              }
            />
          </Routes>
          </Suspense>
        </BrowserRouter>
        </ConfirmationProvider>
      </ConfigProvider>
    </AuthProvider>
  );
}
