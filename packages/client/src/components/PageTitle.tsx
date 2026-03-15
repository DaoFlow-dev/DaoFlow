import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const TITLES: Record<string, string> = {
  "/": "Dashboard — DaoFlow",
  "/projects": "Projects — DaoFlow",
  "/servers": "Servers — DaoFlow",
  "/deployments": "Deployments — DaoFlow",
  "/backups": "Backups — DaoFlow",
  "/settings": "Settings — DaoFlow",
  "/setup": "Setup — DaoFlow",
};

/**
 * Updates the document title based on the current route.
 * Mount once inside the router context.
 */
export function PageTitle() {
  const location = useLocation();

  useEffect(() => {
    const title = TITLES[location.pathname] ?? "DaoFlow";
    document.title = title;
  }, [location.pathname]);

  return null;
}
