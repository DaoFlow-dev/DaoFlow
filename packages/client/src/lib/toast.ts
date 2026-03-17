type ToastType = "success" | "error" | "warning" | "info";

let externalAdd: ((msg: string, type: ToastType) => void) | null = null;

export function registerToastDispatcher(dispatch: ((msg: string, type: ToastType) => void) | null) {
  externalAdd = dispatch;
}

export const toast = {
  success: (msg: string) => externalAdd?.(msg, "success"),
  error: (msg: string) => externalAdd?.(msg, "error"),
  warning: (msg: string) => externalAdd?.(msg, "warning"),
  info: (msg: string) => externalAdd?.(msg, "info")
};

export type { ToastType };
