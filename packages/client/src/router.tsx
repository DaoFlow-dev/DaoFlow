import { createBrowserRouter } from "react-router-dom";
import App from "./App";

/**
 * Central route definitions for DaoFlow.
 *
 * Phase 1 starts with a single catch-all route that renders the existing
 * monolithic dashboard. As pages are extracted in later tasks, each route
 * will point to its own page component.
 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
  },
]);
