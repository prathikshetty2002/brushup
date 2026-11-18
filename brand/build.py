"""Builds the Brushup logo masters (SVG) from Noto Serif Display Italic (SIL OFL). Run: python3 brand/build.py"""
import math, re, pathlib
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

OUT = pathlib.Path(__file__).parent
FONTS = '/usr/share/fonts/noto/NotoSerifDisplay-'
INK, VERM, PAPER, VERM_DARK = '#1d1b17', '#c73a19', '#faf8f3', '#f06a48'

def num(m):
    v = round(float(m.group()), 2)
    return str(int(v)) if v == int(v) else f'{v:g}'

def outline(text, size, x0, baseline, face='Italic', track=0):
    f = TTFont(f'{FONTS}{face}.ttf'); gs = f.getGlyphSet(); cmap = f.getBestCmap(); upem = f['head'].unitsPerEm
    sc = size / upem; x = x0; parts = []
    for ch in text:
        g = cmap[ord(ch)]; pen = SVGPathPen(gs)
        gs[g].draw(TransformPen(pen, (sc, 0, 0, -sc, x, baseline)))
        parts.append(pen.getCommands()); x += (f['hmtx'][g][0] + track) * sc
    return re.sub(r'-?\d+\.\d+', num, ' '.join(parts)), x

def svg(body, w=256, h=256, title='Brushup', x=0, y=0):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} {y} {w} {h}" width="{w}" height="{h}" role="img"><title>{title}</title>{body}</svg>\n'

# ---- the swipe: a loaded-brush stroke, flat start, bristle-split end (edges parallel at 4 degrees) ----
SWIPE = 'M24 140L206 127.3L236 131L224 148L238 157L214 176.7L24 190Z'
B_FULL, _ = outline('b', 232, 58, 215, 'SemiBoldItalic')

def symbol(ink=INK, acc=VERM):
    return f'<path d="{SWIPE}" fill="{acc}"/><path d="{B_FULL}" fill="{ink}"/>'

def symbol_mono(fill='#000', sw=12):
    # one colour: the swipe becomes a hollow ribbon behind a solid letter, so the two never merge into a blob
    return (f'<path d="{SWIPE}" fill="none" stroke="{fill}" stroke-width="{sw}" stroke-linejoin="miter"/>'
            f'<path d="{B_FULL}" fill="{fill}"/>')

# ---- small-size cut (16-32 px): heavier letter, plain swipe, no bristle detail ----
B_SMALL, _ = outline('b', 246, 46, 220, 'ExtraBoldItalic')
SWIPE_SMALL = 'M12 132L226 116L244 126L226 138L244 152L222 190L12 204Z'.replace('L226 138L244 152L222 190', 'L226 140L244 154L224 188')
def symbol_small(ink=INK, acc=VERM):
    return f'<path d="{SWIPE_SMALL}" fill="{acc}"/><path d="{B_SMALL}" fill="{ink}"/>'

def symbol_small_mono(fill='#000'):
    return (f'<path d="{SWIPE_SMALL}" fill="none" stroke="{fill}" stroke-width="22" stroke-linejoin="miter"/>'
            f'<path d="{B_SMALL}" fill="{fill}"/>')

# ---- wordmark & lockups ----
WORD, WEND = outline('Brushup', 205, 0, 186, 'Italic', track=-6)
def wordmark(fill=INK): return f'<path d="{WORD}" fill="{fill}"/>'

def horizontal(ink=INK, acc=VERM, mono=False):
    mark = symbol_mono(ink) if mono else symbol(ink, acc)
    g = 40
    return svg(f'<g>{mark}</g><g transform="translate({256+g} 0)">{wordmark(ink)}</g>', int(256 + g + WEND + 24), 256)

def stacked(ink=INK, acc=VERM, mono=False):
    mark = symbol_mono(ink) if mono else symbol(ink, acc)
    W = int(WEND + 48); s = 0.95
    return svg(f'<g transform="translate({(W - 256*s)/2:.1f} 0) scale({s})">{mark}</g><g transform="translate(24 {256*s + 6:.1f}) scale(0.78)">{wordmark(ink)}</g>', W, int(256*s + 6 + 250*0.78))

# ---- app / favicon tiles: ink tile, paper letter, lighter vermilion swipe (reads on any tab or home screen) ----
def tile(radius, scale, dy=4):
    t = 128 * (1 - scale)
    fill = f'<rect width="256" height="256" rx="{radius}" fill="{INK}"/>' if radius else f'<rect width="256" height="256" fill="{INK}"/>'
    return svg(fill + f'<g transform="translate({t:.1f} {t + dy*scale:.1f}) scale({scale})">{symbol_small(PAPER, VERM_DARK)}</g>')

def write(name, content): (OUT / name).write_text(content)

if __name__ == '__main__':
    write('symbol.svg', svg(symbol()))
    write('symbol-mono.svg', svg(symbol_mono()))
    write('symbol-small.svg', svg(symbol_small()))
    write('symbol-small-mono.svg', svg(symbol_small_mono()))
    write('symbol-reversed.svg', svg(symbol(PAPER, VERM_DARK)))
    write('symbol-small-reversed.svg', svg(symbol_small(PAPER, VERM_DARK)))
    write('wordmark.svg', svg(wordmark(), int(WEND + 24), 256))
    write('lockup-horizontal.svg', horizontal())
    write('lockup-horizontal-mono.svg', horizontal('#000', mono=True))
    write('lockup-horizontal-reversed.svg', horizontal(PAPER, VERM_DARK))
    write('lockup-stacked.svg', stacked())
    write('lockup-stacked-reversed.svg', stacked(PAPER, VERM_DARK))
    write('lockup-stacked-mono.svg', stacked('#000', mono=True))
    icons = OUT / 'icons'; icons.mkdir(exist_ok=True)
    (icons / 'favicon.svg').write_text(tile(56, 0.84))
    (icons / 'app-icon.svg').write_text(tile(56, 0.78))
    (icons / 'maskable.svg').write_text(tile(0, 0.6))
    print('built')
