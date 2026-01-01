/**
 * Toast/Snackbar Component
 *
 * Lightweight notification system for user feedback.
 * Shows messages at the bottom of the popup with auto-dismiss.
 */

// =============================================================================
// Types
// =============================================================================

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  /** Message to display */
  message: string;

  /** Type of toast (affects styling) */
  type?: ToastType;

  /** Duration in ms before auto-dismiss (0 = no auto-dismiss) */
  duration?: number;

  /** Action button text */
  action?: string;

  /** Callback when action button clicked */
  onAction?: () => void;
}

interface ActiveToast {
  id: number;
  element: HTMLElement;
  timeout: ReturnType<typeof setTimeout> | null;
}

// =============================================================================
// Toast Manager
// =============================================================================

class ToastManager {
  private container: HTMLElement | null = null;
  private toasts: ActiveToast[] = [];
  private nextId = 0;

  /**
   * Get or create the toast container.
   */
  private getContainer(): HTMLElement {
    if (this.container && document.body.contains(this.container)) {
      return this.container;
    }

    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    document.body.appendChild(this.container);
    return this.container;
  }

  /**
   * Show a toast notification.
   */
  show(options: ToastOptions): number {
    const {
      message,
      type = 'info',
      duration = 3000,
      action,
      onAction,
    } = options;

    const container = this.getContainer();
    const id = this.nextId++;

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');

    // Message
    const messageEl = document.createElement('span');
    messageEl.className = 'toast-message';
    messageEl.textContent = message;
    toast.appendChild(messageEl);

    // Action button (if provided)
    if (action && onAction) {
      const actionBtn = document.createElement('button');
      actionBtn.className = 'toast-action';
      actionBtn.textContent = action;
      actionBtn.addEventListener('click', () => {
        onAction();
        this.dismiss(id);
      });
      toast.appendChild(actionBtn);
    }

    // Dismiss button
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'toast-dismiss';
    dismissBtn.innerHTML = '&times;';
    dismissBtn.title = 'Dismiss';
    dismissBtn.addEventListener('click', () => {
      this.dismiss(id);
    });
    toast.appendChild(dismissBtn);

    // Add to container
    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('toast-visible');
    });

    // Set up auto-dismiss
    let timeout: ReturnType<typeof setTimeout> | null = null;
    if (duration > 0) {
      timeout = setTimeout(() => {
        this.dismiss(id);
      }, duration);
    }

    // Track toast
    this.toasts.push({ id, element: toast, timeout });

    return id;
  }

  /**
   * Dismiss a toast by ID.
   */
  dismiss(id: number): void {
    const index = this.toasts.findIndex(t => t.id === id);
    if (index === -1) return;

    const toast = this.toasts[index];

    // Clear timeout
    if (toast.timeout) {
      clearTimeout(toast.timeout);
    }

    // Animate out
    toast.element.classList.remove('toast-visible');
    toast.element.classList.add('toast-hiding');

    // Remove after animation
    setTimeout(() => {
      toast.element.remove();
    }, 200);

    // Remove from tracking
    this.toasts.splice(index, 1);
  }

  /**
   * Dismiss all toasts.
   */
  dismissAll(): void {
    for (const toast of [...this.toasts]) {
      this.dismiss(toast.id);
    }
  }
}

// Singleton instance
const toastManager = new ToastManager();

// =============================================================================
// Public API
// =============================================================================

/**
 * Show a toast notification.
 */
export function showToast(options: ToastOptions): number;
export function showToast(message: string, type?: ToastType): number;
export function showToast(
  messageOrOptions: string | ToastOptions,
  type?: ToastType
): number {
  if (typeof messageOrOptions === 'string') {
    return toastManager.show({ message: messageOrOptions, type });
  }
  return toastManager.show(messageOrOptions);
}

/**
 * Dismiss a toast by ID.
 */
export function dismissToast(id: number): void {
  toastManager.dismiss(id);
}

/**
 * Dismiss all toasts.
 */
export function dismissAllToasts(): void {
  toastManager.dismissAll();
}

// Convenience methods
export const toast = {
  info: (message: string, duration?: number) =>
    showToast({ message, type: 'info', duration }),

  success: (message: string, duration?: number) =>
    showToast({ message, type: 'success', duration }),

  warning: (message: string, duration?: number) =>
    showToast({ message, type: 'warning', duration }),

  error: (message: string, duration?: number) =>
    showToast({ message, type: 'error', duration }),

  dismiss: dismissToast,
  dismissAll: dismissAllToasts,
};
