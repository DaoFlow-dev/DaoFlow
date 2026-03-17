import { createBrowserRouter } from "react-router-dom";
import { DashboardLayout } from "./layouts/DashboardLayout";
import DashboardPage from "./pages/DashboardPage";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import ServersPage from "./pages/ServersPage";
import DeploymentsPage from "./pages/DeploymentsPage";
import BackupsPage from "./pages/BackupsPage";
import DestinationsPage from "./pages/DestinationsPage";
import SettingsPage from "./pages/SettingsPage";
import SetupWizardPage from "./pages/SetupWizardPage";
import ServiceDetailPage from "./pages/ServiceDetailPage";
import AgentsPage from "./pages/AgentsPage";
import GitCallbackPage from "./pages/GitCallbackPage";
import LoginPage from "./pages/LoginPage";
import NotFoundPage from "./pages/NotFoundPage";

/**
 * Central route definitions for DaoFlow.
 *
 * /login — public landing page with sign-in / sign-up
 * DashboardLayout gates on session and redirects to /login if unauthenticated.
 */
export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: <DashboardLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "projects", element: <ProjectsPage /> },
      { path: "projects/:id", element: <ProjectDetailPage /> },
      { path: "services/:id", element: <ServiceDetailPage /> },
      { path: "servers", element: <ServersPage /> },
      { path: "deployments", element: <DeploymentsPage /> },
      { path: "backups", element: <BackupsPage /> },
      { path: "destinations", element: <DestinationsPage /> },
      { path: "agents", element: <AgentsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "settings/git/callback", element: <GitCallbackPage /> },
      { path: "setup", element: <SetupWizardPage /> },
      { path: "*", element: <NotFoundPage /> }
    ]
  }
]);
