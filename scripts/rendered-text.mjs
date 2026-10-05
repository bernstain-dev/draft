// Read visible React test-renderer text without counting decorative SVG nodes.
export function renderedText(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || node.props?.['aria-hidden'] === true || node.props?.['aria-hidden'] === 'true') return '';
  return (node.children ?? []).map(renderedText).join('');
}
