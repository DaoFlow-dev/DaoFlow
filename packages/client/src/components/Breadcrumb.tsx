import { Link, useLocation } from "react-router-dom";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items?: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  const location = useLocation();

  // Auto-generate breadcrumbs from URL path if no items provided
  const crumbs: BreadcrumbItem[] =
    items ??
    (() => {
      const segments = location.pathname.split("/").filter(Boolean);
      return [
        { label: "Dashboard", href: "/" },
        ...segments.map((seg, i) => ({
          label: seg.charAt(0).toUpperCase() + seg.slice(1),
          href: i < segments.length - 1 ? "/" + segments.slice(0, i + 1).join("/") : undefined
        }))
      ];
    })();

  if (crumbs.length <= 1) return null;

  return (
    <nav className="df-breadcrumb" aria-label="Breadcrumb">
      <ol className="df-breadcrumb__list">
        {crumbs.map((crumb, i) => (
          <li key={i} className="df-breadcrumb__item">
            {i > 0 && <span className="df-breadcrumb__sep">/</span>}
            {crumb.href ? (
              <Link to={crumb.href} className="df-breadcrumb__link">
                {crumb.label}
              </Link>
            ) : (
              <span className="df-breadcrumb__current">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
