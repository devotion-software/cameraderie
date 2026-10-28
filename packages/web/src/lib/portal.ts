/** Moves a node to `document.body` so `position: fixed` isn't scoped to an
 * ancestor's containing block (e.g. one with `backdrop-filter`/`filter`/`transform`). */
export function portal(node: HTMLElement) {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}
