import type { TransitionBeforeSwapEvent } from 'astro:transitions/client';

const dialogSelector = '[data-panel-dialog]';
document.addEventListener('astro:before-swap', event => {
  const { newDocument, viewTransition } = event as TransitionBeforeSwapEvent;
  // The page snapshot can paint over the native dialog while it opens.
  if (document.querySelector(dialogSelector) || newDocument.querySelector(dialogSelector)) {
    void viewTransition.ready.catch(() => {});
    viewTransition.skipTransition();
  }
});

document.addEventListener('astro:page-load', () => {
  const dialog = document.querySelector<HTMLDialogElement>(dialogSelector);
  if (!dialog) {
    const row = location.hash.startsWith('#registro-') && document.getElementById(location.hash.slice(1));
    if (row) row.focus({ preventScroll: true });
    return;
  }
  dialog.close();
  dialog.showModal();
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    dialog.querySelector<HTMLAnchorElement>('[data-dialog-close]')?.click();
  });
});
