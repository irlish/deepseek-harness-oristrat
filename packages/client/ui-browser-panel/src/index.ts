/**
 * Embedded browser panel, node half. Pure UI plugin: the empty apply exists
 * so the plugin appears in the host cordis.yml / Loader; the browser half
 * ships via exports["./client"], discovered through the package.json
 * dsh.client declaration. The WebContentsView it steers lives in the desktop
 * application main process (`apps/desktop/src/browser-view.ts`).
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
