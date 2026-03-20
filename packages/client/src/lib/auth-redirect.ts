export function redirectToLoginWithReturnTo() {
  if (typeof window === "undefined") {
    return;
  }

  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const returnTo = currentPath === "/login" ? "/" : currentPath;
  window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

export function maybeRedirectToLoginForHttpStatus(status: number | null | undefined) {
  if (status === 401) {
    redirectToLoginWithReturnTo();
  }
}
