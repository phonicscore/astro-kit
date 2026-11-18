"""
The default share-card fonts (lib/og-cards.js): assets/fonts/inter-latin-400.ttf and
inter-latin-700.ttf, Inter Regular and Bold as TTF (canvaskit reads no web fonts).

Each is the Latin file the kit shipped since 1.4.0 (git d9b2058) with Fontsource's Latin
Extended subset added (1.16.0): Polish ą ć ę ł ń ś ź ż, Czech, Hungarian, Turkish and
the like. The Latin glyphs, metrics and kerning stay exactly as they were, so a card in
English or German draws the same pixels as before; the added letters come without their
layout tables (merged kerning moved Latin letters by a pixel or two). Inter is under the
SIL Open Font License 1.1 (assets/fonts/OFL.txt).

    npm install --no-save --prefix /tmp/fontsource @fontsource/inter@5.3.0
    python3 scripts/make-card-fonts.py /tmp/fontsource/node_modules/@fontsource/inter/files

Needs fontTools and brotli (python3 -m pip install fonttools brotli). Not part of the package.
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from fontTools.merge import Merger
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / 'assets/fonts'
LATIN_FROM = 'd9b2058'

if len(sys.argv) != 2:
    sys.exit(__doc__)
fontsource = Path(sys.argv[1])

for weight in (400, 700):
    name = f'inter-latin-{weight}.ttf'
    with tempfile.TemporaryDirectory() as tmp:
        latin = Path(tmp) / 'latin.ttf'
        latin.write_bytes(subprocess.run(['git', 'show', f'{LATIN_FROM}:assets/fonts/{name}'], cwd=ROOT, check=True, capture_output=True).stdout)
        ext = TTFont(fontsource / f'inter-latin-ext-{weight}-normal.woff2')
        ext.flavor = None
        for tag in ('GPOS', 'GSUB', 'GDEF'):
            if tag in ext:
                del ext[tag]
        ext.save(Path(tmp) / 'ext.ttf')
        font = Merger().merge([str(latin), str(Path(tmp) / 'ext.ttf')])
    font.save(FONTS / name)
    print(f'{name}: {(FONTS / name).stat().st_size // 1024} KB, {len(font.getGlyphOrder())} glyphs')
