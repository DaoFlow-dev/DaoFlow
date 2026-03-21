const RECENT_STORAGE_KEY = "daoflow-recent-pages";
const MAX_RECENT = 5;

export function loadRecentPages(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((path): path is string => typeof path === "string");
    }

    return [];
  } catch {
    return [];
  }
}

export function saveRecentPage(path: string) {
  const recent = loadRecentPages().filter((entry) => entry !== path);
  recent.unshift(path);
  localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}
