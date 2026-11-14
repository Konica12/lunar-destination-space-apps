"""Package web/dist as a single-page preview (inline CSS/JS, data as JSON files)."""
import re, shutil, sys, os
src = os.path.join(os.path.dirname(__file__), '..', 'web', 'dist')
out = sys.argv[1]
shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
shutil.copytree(os.path.join(src, 'data'), os.path.join(out, 'data'))
shutil.copytree(os.path.join(src, 'textures'), os.path.join(out, 'textures'))
s = open(os.path.join(src, 'index.html')).read()
head = re.search(r'<head>(.*)</head>', s, re.S).group(1)
body = re.search(r'<body>(.*)</body>', s, re.S).group(1)
head = re.sub(r'<meta charset[^>]*>\s*', '', head)
head = re.sub(r'<meta name="viewport"[^>]*>\s*', '', head)
head = re.sub(r'\s*<script type="module" crossorigin src="./assets/app.js"></script>', '', head)
css = open(os.path.join(src, 'assets', 'index.css')).read()
js = open(os.path.join(src, 'assets', 'app.js')).read().replace('</script', '<\\/script')
head = head.replace('<link rel="stylesheet" crossorigin href="./assets/index.css">', '<style>' + css + '</style>')
open(os.path.join(out, 'index.html'), 'w').write(head.strip() + '\n' + body.strip() + '\n<script type="module">' + js + '</script>\n')
print('packaged', sorted(os.listdir(os.path.join(out, 'data'))))
