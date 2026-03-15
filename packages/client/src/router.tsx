import { createBrowserRouter } from "react-router-dom";
import { DashboardLayout } from "./layouts/DashboardLayout";
import App from "./App";

/**
 * Central route definitions for DaoFlow.
 *
 * DashboardLayout provides the sidebar + topbar shell.
 * App renders as the index page; new pages will be added as siblings.
 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <DashboardLayout />,
    children: [
      { index: true, element: <App /> },
    ],
  },
]);
