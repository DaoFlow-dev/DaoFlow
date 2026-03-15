/**
 * App.tsx — thin re-export of the DashboardPage.
 *
 * The monolithic dashboard has been extracted to pages/DashboardPage.tsx.
 * This file exists for backward compatibility with any imports that
 * reference App directly (e.g. tests).
 */
export { default } from "./pages/DashboardPage";
