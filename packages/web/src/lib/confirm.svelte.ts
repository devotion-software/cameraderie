export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve?: (value: boolean) => void;
}

const state = $state<ConfirmState>({ open: false, message: '' });

export function getConfirmState(): ConfirmState {
  return state;
}

/** Replaces the browser's `confirm()` with the app's own dialog (see ConfirmDialog.svelte). */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    state.open = true;
    state.title = options.title;
    state.message = options.message;
    state.confirmLabel = options.confirmLabel ?? 'Confirm';
    state.cancelLabel = options.cancelLabel ?? 'Cancel';
    state.danger = options.danger ?? false;
    state.resolve = resolve;
  });
}

export function resolveConfirm(result: boolean): void {
  state.resolve?.(result);
  state.open = false;
  state.resolve = undefined;
}
