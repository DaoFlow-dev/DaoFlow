const ID_SEGMENT_RE =
  /^[0-9a-f]{9,}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatSegment(s: string): string {
  if (ID_SEGMENT_RE.test(s)) return s.slice(0, 8) + "…";
  return s
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export interface Breadcrumb {
  label: string;
  path: string;
}

export function breadcrumbFromPath(pathname: string): Breadcrumb[] {
  if (pathname === "/") return [{ label: "Dashboard", path: "/" }];
  const segments = pathname.split("/").filter(Boolean);
  return segments.map((s, i) => {
    const path = "/" + segments.slice(0, i + 1).join("/");
    return { label: formatSegment(s), path: path === "/dashboard" ? "/" : path };
  });
}
