import os
import glob
import re

html_files = glob.glob('*.html')

pwa_head = """
    <link rel="manifest" href="manifest.json">
    <meta name="theme-color" content="#ffffff">
    <link rel="apple-touch-icon" href="https://cdn-icons-png.flaticon.com/512/3594/3594363.png">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
"""

pwa_script = """
    <script>
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('sw.js')
                    .then(reg => console.log('SW registrado', reg))
                    .catch(e => console.error('Error SW', e));
            });
        }
    </script>
"""

for file in html_files:
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check if already has manifest
    if 'manifest.json' not in content:
        # Add to head
        content = content.replace('</head>', pwa_head + '</head>')
    
    # Check if already registers SW
    if 'serviceWorker.register' not in content:
        # Add before body closing
        content = content.replace('</body>', pwa_script + '</body>')
        
    with open(file, 'w', encoding='utf-8') as f:
        f.write(content)

print(f"Processed {len(html_files)} files.")
