import math
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

INK, VERM = '#1d1b17', '#c73a19'
FONT = '/usr/share/fonts/noto/NotoSerifDisplay-Italic.ttf'

def svg(body, vb='0 0 256 256', title='Brushup'):
    w, h = vb.split()[2:]
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w}" height="{h}" role="img"><title>{title}</title>{body}</svg>\n'

def r(x): return f'{x:.2f}'.rstrip('0').rstrip('.')

# ---------- wordmark outlines ----------
def word_path(text, size, x0, baseline, track=0, font=None):
    f = TTFont(font or FONT); gs = f.getGlyphSet(); cmap = f.getBestCmap(); upem = f['head'].unitsPerEm
    sc = size / upem; x = x0; parts = []
    for ch in text:
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        tp = TransformPen(pen, (sc, 0, 0, -sc, x, baseline))
        gs[g].draw(tp)
        parts.append(pen.getCommands())
        x += (f['hmtx'][g][0] + track) * sc
    return ' '.join(parts), x

# ---------- polygon clipping (convex half-planes) ----------
def clip(poly, a, b, c):  # keep a*x + b*y <= c
    out = []
    for i in range(len(poly)):
        p, q = poly[i], poly[(i + 1) % len(poly)]
        fp, fq = a*p[0] + b*p[1] - c, a*q[0] + b*q[1] - c
        if fp <= 0: out.append(p)
        if (fp < 0 < fq) or (fq < 0 < fp):
            t = fp / (fp - fq); out.append((p[0] + t*(q[0]-p[0]), p[1] + t*(q[1]-p[1])))
    return out

def path(poly): return 'M' + ' L'.join(f'{r(x)} {r(y)}' for x, y in poly) + 'Z'
def big(cx, cy, s=2000): return [(cx-s, cy-s), (cx+s, cy-s), (cx+s, cy+s), (cx-s, cy+s)]

# ---------- A: Corner ----------
def mark_a(ink=INK, acc=VERM):
    # selection frame: three square corners in ink, the fourth rounded and painted (all filled outlines)
    return (f'<path d="M29 108V29H108V59H59V108ZM29 148H59V197H108V227H29ZM227 148V227H148V197H197V148Z" fill="{ink}"/>'
            f'<path d="M148 29A79 79 0 0 1 227 108H197A49 49 0 0 0 148 59Z" fill="{acc}"/>')

# ---------- B: Swipe ----------
def mark_b(ink=INK, acc=VERM, left=22, top=46, size=164, theta=20, w=56, gap=9, shift=0):
    th = math.radians(theta); d = (math.cos(th), -math.sin(th)); n = (math.sin(th), math.cos(th))
    cx, cy = left + size/2, top + size/2
    sq = [(left, top), (left+size, top), (left+size, top+size), (left, top+size)]
    def half(poly, sgn, s):  # keep sgn*((p-c).n) <= s
        return clip(poly, sgn*n[0], sgn*n[1], s + sgn*(cx*n[0] + cy*n[1]))
    upper = half(sq, 1, shift - w/2 - gap)
    lower = half(sq, -1, -(shift + w/2 + gap))
    band = half(half(big(cx, cy), 1, shift + w/2), -1, -(shift - w/2))
    solid = clip(band, -1, 0, -left)                       # starts on the square's left edge
    right = left + size
    # streaks: 5 bristles, each ends on its own slanted cut; the slits between them start at different depths
    k, sl = 4, 6.0; sw = (w - sl*(k-1)) / k
    ends = [50, 22, 40, 16]; starts = [8, 24, 14, 28]   # slit start (px before the right edge), end (px past it)
    al = math.radians(34); m = (d[0]*math.cos(al) + n[0]*math.sin(al), d[1]*math.cos(al) + n[1]*math.sin(al))
    parts = []
    for j in range(k):
        a0 = shift - w/2 + j*(sw + sl); a1 = a0 + sw
        # full-width body for this streak (no slit) up to its slit start, then the narrow streak to its tip
        lo = a0 - (sl/2 + 1 if j else 0); hi = a1 + (sl/2 + 1 if j < k-1 else 0)
        body = half(half(big(cx, cy), 1, hi), -1, -lo)
        body = clip(body, -1, 0, -left)
        sm = (a0 + a1)/2
        t_edge = ((right - cx) - sm*n[0]) / d[0]
        pref = (cx + t_edge*d[0] + sm*n[0], cy + t_edge*d[1] + sm*n[1])
        body = clip(body, 1, 0, right - starts[j])                    # wide part stops before the right edge
        narrow = half(half(big(cx, cy), 1, a1), -1, -a0)
        narrow = clip(clip(narrow, -1, 0, -(right - starts[j] - 1)), m[0], m[1], m[0]*pref[0] + m[1]*pref[1] + ends[j])
        parts += [body, narrow]
    out = f'<path d="{path(upper)}" fill="{ink}"/><path d="{path(lower)}" fill="{ink}"/>'
    out += ''.join(f'<path d="{path(p)}" fill="{acc}"/>' for p in parts if len(p) >= 3)
    return out

# ---------- C: italic b over a swipe ----------
def mark_c(ink=INK, acc=VERM):
    bp, _ = word_path('b', 232, 58, 215, font='/usr/share/fonts/noto/NotoSerifDisplay-SemiBoldItalic.ttf')
    # a loaded-brush swipe behind the bowl: flat start, slanted bristle-split end
    sw = f'<path d="M22 137L204 123L238 127L226 145L238 153L214 177L24 189Z" fill="{acc}"/>'
    return sw + f'<path d="{bp}" fill="{ink}"/>'

MARKS = {'a': mark_a, 'b': mark_b, 'c': mark_c}

def lockup(mark_body, ink=INK, size=205, gap=58):
    wp, end = word_path('Brushup', size, 256 + gap, 186, track=-6)
    return svg(f'<g>{mark_body}</g><path d="{wp}" fill="{ink}"/>', vb=f'0 0 {int(end+24)} 256')

if __name__ == '__main__':
    for k, fn in MARKS.items():
        open(f'{k}-symbol.svg', 'w').write(svg(fn()))
        open(f'{k}-lockup.svg', 'w').write(lockup(fn()))
    print('ok')
