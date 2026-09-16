from pathlib import Path

write_path = Path('write.html')
write = write_path.read_text(encoding='utf-8')

if '  - /assets/writer-wordtools.css' not in write:
    needle = 'page_styles:\n  - /assets/writer.css\n'
    replacement = 'page_styles:\n  - /assets/writer.css\n  - /assets/writer-wordtools.css\n'
    if needle not in write:
        raise SystemExit('write.html page_styles anchor not found')
    write = write.replace(needle, replacement, 1)

if '  - /assets/writer-wordtools.js' not in write:
    needle = '  - /assets/writer.js\n  - /assets/writer-auth.js\n'
    replacement = '  - /assets/writer.js\n  - /assets/writer-auth.js\n  - /assets/writer-wordtools.js\n'
    if needle not in write:
        raise SystemExit('write.html page_scripts anchor not found')
    write = write.replace(needle, replacement, 1)

write_path.write_text(write, encoding='utf-8')

workflow_path = Path('.github/workflows/writer-production-smoke.yml')
workflow = workflow_path.read_text(encoding='utf-8')

for path_line, after_line in [
    ('      - "assets/writer-wordtools.js"\n', '      - "assets/writer-auth.js"\n'),
    ('      - "assets/writer-wordtools.css"\n', '      - "assets/writer-wordtools.js"\n'),
    ('      - "scripts/writer-wordtools-smoke.spec.cjs"\n', '      - "scripts/writer-smoke.spec.cjs"\n'),
]:
    if path_line not in workflow:
        if after_line not in workflow:
            raise SystemExit(f'workflow path anchor not found: {after_line!r}')
        workflow = workflow.replace(after_line, after_line + path_line, 1)

if 'local_word_js=' not in workflow:
    needle = '''          local_js="$(sha256sum assets/writer.js | awk '{print $1}')"
          local_css="$(sha256sum assets/writer.css | awk '{print $1}')"
'''
    replacement = '''          local_js="$(sha256sum assets/writer.js | awk '{print $1}')"
          local_css="$(sha256sum assets/writer.css | awk '{print $1}')"
          local_word_js="$(sha256sum assets/writer-wordtools.js | awk '{print $1}')"
          local_word_css="$(sha256sum assets/writer-wordtools.css | awk '{print $1}')"
'''
    if needle not in workflow:
        raise SystemExit('workflow local hash anchor not found')
    workflow = workflow.replace(needle, replacement, 1)

if '/tmp/live-writer-wordtools.js' not in workflow:
    needle = '''            curl -fsSL "https://mmamatlock.com/assets/writer.js?release=${WRITER_SHA}-${attempt}" -o /tmp/live-writer.js || true
            curl -fsSL "https://mmamatlock.com/assets/writer.css?release=${WRITER_SHA}-${attempt}" -o /tmp/live-writer.css || true
'''
    replacement = '''            curl -fsSL "https://mmamatlock.com/assets/writer.js?release=${WRITER_SHA}-${attempt}" -o /tmp/live-writer.js || true
            curl -fsSL "https://mmamatlock.com/assets/writer.css?release=${WRITER_SHA}-${attempt}" -o /tmp/live-writer.css || true
            curl -fsSL "https://mmamatlock.com/assets/writer-wordtools.js?release=${WRITER_SHA}-${attempt}" -o /tmp/live-writer-wordtools.js || true
            curl -fsSL "https://mmamatlock.com/assets/writer-wordtools.css?release=${WRITER_SHA}-${attempt}" -o /tmp/live-writer-wordtools.css || true
'''
    if needle not in workflow:
        raise SystemExit('workflow curl anchor not found')
    workflow = workflow.replace(needle, replacement, 1)

if 'live_word_js=' not in workflow:
    needle = '''            live_js="$(sha256sum /tmp/live-writer.js 2>/dev/null | awk '{print $1}')"
            live_css="$(sha256sum /tmp/live-writer.css 2>/dev/null | awk '{print $1}')"
            if [ "$live_js" = "$local_js" ] && [ "$live_css" = "$local_css" ]; then
'''
    replacement = '''            live_js="$(sha256sum /tmp/live-writer.js 2>/dev/null | awk '{print $1}')"
            live_css="$(sha256sum /tmp/live-writer.css 2>/dev/null | awk '{print $1}')"
            live_word_js="$(sha256sum /tmp/live-writer-wordtools.js 2>/dev/null | awk '{print $1}')"
            live_word_css="$(sha256sum /tmp/live-writer-wordtools.css 2>/dev/null | awk '{print $1}')"
            if [ "$live_js" = "$local_js" ] && [ "$live_css" = "$local_css" ] && [ "$live_word_js" = "$local_word_js" ] && [ "$live_word_css" = "$local_word_css" ]; then
'''
    if needle not in workflow:
        raise SystemExit('workflow live hash anchor not found')
    workflow = workflow.replace(needle, replacement, 1)

old_run = '        run: npx playwright test scripts/writer-smoke.spec.cjs --workers=1 --reporter=line\n'
new_run = '        run: npx playwright test scripts/writer-smoke.spec.cjs scripts/writer-wordtools-smoke.spec.cjs --workers=1 --reporter=line\n'
if new_run not in workflow:
    if old_run not in workflow:
        raise SystemExit('workflow Playwright run anchor not found')
    workflow = workflow.replace(old_run, new_run, 1)

workflow_path.write_text(workflow, encoding='utf-8')
