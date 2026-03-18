import { Suspense, lazy, type ComponentType } from "react";
import { createBrowserRouter } from "react-router-dom";
import { RouteFallback } from "./components/RouteFallback";
import { DashboardLayout } from "./layouts/DashboardLayout";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage"));
const ProjectDetailPage = lazy(() => import("./pages/ProjectDetailPage"));
const ServersPage = lazy(() => import("./pages/ServersPage"));
const DeploymentsPage = lazy(() => import("./pages/DeploymentsPage"));
const BackupsPage = lazy(() => import("./pages/BackupsPage"));
const DestinationsPage = lazy(() => import("./pages/DestinationsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const SetupWizardPage = lazy(() => import("./pages/SetupWizardPage"));
const ServiceDetailPage = lazy(() => import("./pages/ServiceDetailPage"));
const AgentsPage = lazy(() => import("./pages/AgentsPage"));
const GitCallbackPage = lazy(() => import("./pages/GitCallbackPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const NotificationChannelsPage = lazy(() => import("./pages/NotificationChannelsPage"));
const UserProfilePage = lazy(() => import("./pages/UserProfilePage"));

function routeElement(Component: ComponentType) {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Component />
    </Suspense>
  );
}

/**
 * Central route definitions for DaoFlow.
 *
 * /login — public landing page with sign-in / sign-up
 * DashboardLayout gates on session and redirects to /login if unauthenticated.
 */
export const router = createBrowserRouter([
  { path: "/login", element: routeElement(LoginPage) },
  { path: "/setup", element: routeElement(SetupWizardPage) },
  {
    path: "/",
    element: <DashboardLayout />,
    children: [
      { index: true, element: routeElement(DashboardPage) },
      { path: "projects", element: routeElement(ProjectsPage) },
      { path: "projects/:id", element: routeElement(ProjectDetailPage) },
      { path: "services/:id", element: routeElement(ServiceDetailPage) },
      { path: "servers", element: routeElement(ServersPage) },
      { path: "deployments", element: routeElement(DeploymentsPage) },
      { path: "backups", element: routeElement(BackupsPage) },
      { path: "destinations", element: routeElement(DestinationsPage) },
      { path: "agents", element: routeElement(AgentsPage) },
      { path: "notifications", element: routeElement(NotificationChannelsPage) },
      { path: "settings", element: routeElement(SettingsPage) },
      { path: "settings/git/callback", element: routeElement(GitCallbackPage) },
      { path: "profile", element: routeElement(UserProfilePage) },
      { path: "*", element: routeElement(NotFoundPage) }
    ]
  }
]);
