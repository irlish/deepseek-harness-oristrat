/**
 * jsdom implements no pointer capture. The effort slider's drag contract uses all
 * three methods, so a spec that drives the track installs these stubs and reads
 * the map to see which element holds which pointer.
 * @returns the capture map and the restore that puts the prototype back.
 */
export function stubPointerCapture(): { captured: WeakMap<Element, number>; restore: () => void } {
  const captured = new WeakMap<Element, number>()
  const methods = ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture'] as const
  Object.defineProperty(Element.prototype, 'setPointerCapture', {
    configurable: true,
    writable: true,
    value: function (this: Element, pointerId: number) { captured.set(this, pointerId) },
  })
  Object.defineProperty(Element.prototype, 'releasePointerCapture', {
    configurable: true,
    writable: true,
    value: function (this: Element) { captured.delete(this) },
  })
  Object.defineProperty(Element.prototype, 'hasPointerCapture', {
    configurable: true,
    writable: true,
    value: function (this: Element, pointerId: number) { return captured.get(this) === pointerId },
  })
  return {
    captured,
    restore: () => { for (const name of methods) Reflect.deleteProperty(Element.prototype, name) },
  }
}
