/**
 * Grow a textarea to its content.
 *
 * The base Textarea relies on `field-sizing: content`, which is very recent CSS —
 * on a browser without it these boxes clip a 2000-character data-source binding to
 * three lines, which makes the field unusable for exactly the entries that most
 * need editing. Done on the element rather than through state so there is no
 * render loop.
 */
export function autoSize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
