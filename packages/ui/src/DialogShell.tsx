import type { ComponentChildren } from "preact";

interface DialogShellProps {
  title: string;
  onClose: () => void;
  /** Extra class on the dialog card, for a specific dialog's own CSS/selectors. */
  dialogClass?: string;
  /** Extra class on the title, same reason. */
  titleClass?: string;
  children: ComponentChildren;
}

// The modal chrome shared by every dialog in the comment layer — backdrop, card,
// header with a close affordance — so PromoteDialog and ConfirmDialog (issue
// #103) render one shell instead of each hand-rolling its own.
export function DialogShell({
  title,
  onClose,
  dialogClass,
  titleClass,
  children,
}: DialogShellProps) {
  return (
    <div class="dialog-backdrop" onClick={onClose}>
      <div
        class={`dialog${dialogClass ? ` ${dialogClass}` : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="dialog-header">
          <span class={`dialog-title${titleClass ? ` ${titleClass}` : ""}`}>{title}</span>
          <button class="dialog-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}
