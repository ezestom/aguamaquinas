export function snapIndex(track: HTMLElement, length: number) {
  return Math.max(0, Math.min(Math.round(track.scrollLeft / track.clientWidth) || 0, length - 1));
}

export function scrollToSnap(track: HTMLElement, index: number, immediate = false) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  track.scrollTo({ left: index * track.clientWidth, behavior: immediate || reduceMotion ? 'instant' : 'smooth' });
}
