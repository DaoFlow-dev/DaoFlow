import { createBrowserRouter } from "react-router-dom";
import { DashboardLayout } from "./layouts/DashboardLayout";
import DashboardPage from "./pages/DashboardPage";
import ProjectsPage from "./pages/ProjectsPage";
import ServersPage from "./pages/ServersPage";
import DeploymentsPage from "./pages/DeploymentsPage";
import BackupsPage from "./pages/BackupsPage";
import SettingsPage from "./pages/SettingsPage";
import SetupWizardPage from "./pages/SetupWizardPage";
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
      { path: "servers", element: <ServersPage /> },
      { path: "deployments", element: <DeploymentsPage /> },
      { path: "backups", element: <BackupsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "setup", element: <SetupWizardPage /> },
      { path: "*", element: <NotFoundPage /> }
    ]
  }
]);
