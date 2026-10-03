// Browser APIs reka-ui relies on that jsdom doesn't implement.

Element.prototype.scrollIntoView ??= function () {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.releasePointerCapture ??= function () {}

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
