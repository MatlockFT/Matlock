from pathlib import Path

js_path = Path('assets/writer-wordtools.js')
js = js_path.read_text(encoding='utf-8')

js = js.replace(
    "return `${indent}- ${line.trimStart().replace(/^[-*+]\\s+/, '')}`;",
    "return `${indent}- ${line.trimStart().replace(/^(?:[-*+]|\\d+[.)])\\s+/, '')}`;"
)
js = js.replace(
    "const content = line.trimStart().replace(/^\\d+[.)]\\s+/, '');",
    "const content = line.trimStart().replace(/^(?:\\d+[.)]|[-*+])\\s+/, '');"
)

old = """      const tag = node.tagName.toLowerCase();
      const children = () => renderChildren(node);
      if (['script','style','meta','link','svg'].includes(tag)) return '';
      if (tag === 'br') return '\\n';
"""
new = """      const tag = node.tagName.toLowerCase();
      const children = () => renderChildren(node);
      if (['script','style','meta','link','svg'].includes(tag)) return '';
      if (tag === 'br') return '\\n';
      if (tag === 'span') {
        let value = children();
        const style = String(node.getAttribute('style') || '').toLowerCase();
        if (/font-weight\\s*:\\s*(?:bold|[6-9]00)/.test(style)) value = `**${value.trim()}**`;
        if (/font-style\\s*:\\s*italic/.test(style)) value = `*${value.trim()}*`;
        if (/text-decoration[^;]*line-through/.test(style)) value = `~~${value.trim()}~~`;
        return value;
      }
"""
if old not in js:
    raise SystemExit('span smart-paste anchor not found')
js = js.replace(old, new, 1)

old = """  function openFindDialog(replace = false) {
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
    if (selected && !selected.includes('\\n') && selected.length <= 120) findInput.value = selected;
    findDialog.showModal();
    requestAnimationFrame(() => (replace ? replaceInput : findInput).focus());
  }
"""
new = """  function openFindDialog(replace = false) {
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
    if (selected && !selected.includes('\\n') && selected.length <= 120) findInput.value = selected;
    if (!findDialog.open) findDialog.showModal();
    requestAnimationFrame(() => (replace ? replaceInput : findInput).focus());
  }
"""
if old not in js:
    raise SystemExit('find dialog anchor not found')
js = js.replace(old, new, 1)

old = """    if (event.key === 'Escape') {
      if (document.body.classList.contains('writer-wordtools-fullscreen')) toggleFullscreen();
      else if (app.classList.contains('writer-wordtools-focus')) toggleFocusMode();
    }
"""
new = """    if (event.key === 'Escape') {
      if (findDialog.open) return;
      if (document.body.classList.contains('writer-wordtools-fullscreen')) toggleFullscreen();
      else if (app.classList.contains('writer-wordtools-focus')) toggleFocusMode();
    }
"""
if old not in js:
    raise SystemExit('escape anchor not found')
js = js.replace(old, new, 1)

js_path.write_text(js, encoding='utf-8')

spec_path = Path('scripts/writer-wordtools-smoke.spec.cjs')
spec = spec_path.read_text(encoding='utf-8')
spec = spec.replace("/1\\. - First item\\n2\\. - Second item/", "/1\\. First item\\n2\\. Second item/")
spec = spec.replace("await findDialog.getByRole('button', { name: 'Close' }).click();", "await findDialog.locator('.writer-dialog-actions button[value=\"cancel\"]').click();")
spec_path.write_text(spec, encoding='utf-8')
