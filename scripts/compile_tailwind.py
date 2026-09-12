import re
import glob
import json
import subprocess
import os

def main():
    classes = set()
    # Scan all html and js files in frontend
    for f in glob.glob('frontend/**/*.html', recursive=True) + glob.glob('frontend/**/*.js', recursive=True):
        if 'vendor' in f:
            continue
        try:
            with open(f, 'r', encoding='utf-8', errors='ignore') as fp:
                content = fp.read()
            for m in re.findall(r'class=["\']([^"\']+)["\']', content):
                for c in m.split():
                    c = c.strip()
                    if c and '${' not in c and '}' not in c and '<' not in c and '>' not in c:
                        classes.add(c)
        except Exception as e:
            print(f"Error reading {f}: {e}")

    # Also scan for dynamic classes in app.js
    app_js = 'frontend/js/app.js'
    if os.path.exists(app_js):
        with open(app_js, 'r', encoding='utf-8', errors='ignore') as fp:
            text = fp.read()
        # Find all string literals that look like tailwind classes
        tokens = re.findall(r'[\'"`]([a-zA-Z0-9_\-\:\[\]\/\.\#\%\(\)]+)[\'"`]', text)
        for t in tokens:
            t = t.strip()
            if any(prefix in t for prefix in ['bg-', 'text-', 'border-', 'p-', 'px-', 'py-', 'm-', 'mx-', 'my-', 'flex', 'grid', 'w-', 'h-', 'rounded', 'shadow', 'hover:', 'dark:', 'space-', 'gap-', 'items-', 'justify-']):
                if len(t) < 50 and not t.startswith('http'):
                    classes.add(t)

    sorted_classes = sorted(list(classes))
    print(f"Total unique classes extracted: {len(sorted_classes)}")

    # Write out classes list to JSON
    with open('scripts/extracted_classes.json', 'w') as fp:
        json.dump(sorted_classes, fp)

if __name__ == '__main__':
    main()
