"""
Turns the four source cards into token art.

For each card: crop the drawing, upscale it with Real-ESRGAN, flatten the parchment to white,
and keep the drawing as ink with transparency (plus white highlights inside the weapon), so it
can sit on any parchment-colored face. Output is a square image with the weapon centred.
"""
import os
import sys

# Isolated mode leaves this folder off the path; the upscaler module lives beside this file.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
import torch
from sr import load, upscale

SIZE = 640

# crop: the drawing on the card. pre: resize before upscaling (the net result is pre * 4).
# mix: share of the line-art model in the blend. hull: outline around the weapon, card pixels.
SPECS = {
    'halberd': dict(
        crop=(20, 40, 166, 162), pre=1.0, mix=0.5,
        hull=[(37, 142), (40, 97), (56, 95), (61, 86), (70, 83), (74, 91), (78, 80), (87, 78), (97, 86),
              (143, 53), (151, 58), (148, 66), (102, 101), (100, 112), (94, 117), (92, 127), (86, 151),
              (75, 151), (69, 129), (56, 137), (42, 145)],
    ),
    'crossbow': dict(
        crop=(40, 70, 214, 214), pre=1.0, mix=0.5,
        hull=[(110, 92), (121, 90), (147, 101), (166, 97), (176, 100), (191, 109), (191, 125), (184, 131),
              (197, 170), (197, 187), (186, 189), (160, 160), (150, 163), (104, 168), (74, 194), (60, 193),
              (56, 180), (60, 170), (96, 148), (112, 143), (72, 143), (60, 140), (58, 124), (68, 121),
              (74, 127), (118, 131), (131, 119), (117, 103)],
    ),
    'axe': dict(
        crop=(120, 170, 630, 630), pre=0.5, mix=0.0, soften=1.3,
        hull=[(581, 207), (593, 208), (596, 218), (591, 225), (365, 376), (306, 418), (355, 424), (370, 435),
              (373, 490), (359, 538), (325, 575), (270, 594), (180, 589), (170, 570), (159, 515), (154, 450),
              (231, 408), (295, 401), (355, 361)],
    ),
    'sword': dict(
        crop=(80, 0, 560, 360), pre=0.5, mix=0.0,
        hull=[(118, 346), (120, 330), (195, 243), (296, 176), (380, 104), (392, 84), (425, 80), (440, 84),
              (478, 38), (500, 32), (520, 44), (522, 74), (508, 90), (470, 112), (468, 140), (440, 152),
              (410, 176), (306, 258), (196, 330), (140, 350)],
    ),
}


def polygon_mask(size, points):
    mask = Image.new('L', size, 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return np.asarray(mask, dtype=np.float32) / 255


def build(name, spec, nets, device, src, out):
    x0, y0, x1, y1 = spec['crop']
    card = Image.open(f'{src}/{name}.png').convert('RGB').crop(spec['crop'])
    if spec.get('soften'):
        card = card.filter(ImageFilter.GaussianBlur(spec['soften']))
    if spec['pre'] != 1.0:
        card = card.resize((round(card.width * spec['pre']), round(card.height * spec['pre'])), Image.LANCZOS)
    scale = spec['pre'] * 4
    image = np.asarray(upscale(nets['general'], card, device), dtype=np.float32) / 255
    if spec['mix'] > 0:
        lines = np.asarray(upscale(nets['anime'], card, device), dtype=np.float32) / 255
        image = image * (1 - spec['mix']) + lines * spec['mix']
    height, width = image.shape[:2]
    Image.fromarray((image * 255 + 0.5).astype(np.uint8)).save(f'{out}/clean-{name}.png')

    hull_points = [((x - x0) * scale, (y - y0) * scale) for x, y in spec['hull']]
    hull = polygon_mask((width, height), hull_points)

    # Parchment color under the weapon, estimated from the paper around it.
    luma = image @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    outside = 1 - ndi.binary_dilation(hull > 0.5, iterations=round(3 * scale)).astype(np.float32)
    paper = outside * (luma > 0.8 * np.median(luma[outside > 0.5]))
    sigma = 0.12 * width
    weight = ndi.gaussian_filter(paper, sigma) + 1e-6
    background = np.stack([ndi.gaussian_filter(image[..., c] * paper, sigma) / weight for c in range(3)], axis=-1)
    flat = image / np.maximum(background, 1e-3)

    # Ink: whatever is darker than the paper, as a dark color with transparency.
    white = spec.get('white', 0.9)
    tone = np.clip(flat / white, 0, 1)
    ink = 1 - tone.min(axis=-1)
    color = (tone - (1 - ink[..., None])) / np.maximum(ink[..., None], 1e-3)
    # Highlights: brighter than the paper, inside the weapon only.
    core = ndi.binary_erosion(hull > 0.5, iterations=round(2 * scale)).astype(np.float32)
    shine = np.clip((flat.min(axis=-1) - 1.03) / 0.12, 0, 1) * core * 0.9
    gate = spec.get('gate', 0.07)
    ink = np.clip((ink - gate) / (1 - gate), 0, 1)
    reach = spec.get('reach', 5) * scale
    near = ndi.gaussian_filter(ndi.binary_dilation(ink > 0.4, iterations=round(reach)).astype(np.float32), 0.4 * reach)
    ink = ink * np.clip(near * 1.6, 0, 1)
    lit = shine > ink
    alpha = np.where(lit, shine, ink) * ndi.gaussian_filter(hull, 1.2 * scale)
    color = np.where(lit[..., None], 1.0, np.clip(color, 0, 1))

    # Centre the weapon on a square canvas.
    ys, xs = np.nonzero(alpha > 0.04)
    top, bottom, left, right = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    side = round(max(bottom - top, right - left) * 1.06)
    canvas = np.zeros((side, side, 4), dtype=np.float32)
    oy, ox = (side - (bottom - top)) // 2, (side - (right - left)) // 2
    premultiplied = np.dstack([color * alpha[..., None], alpha])[top:bottom, left:right]
    canvas[oy : oy + bottom - top, ox : ox + right - left] = premultiplied
    small = cv2.resize(canvas, (SIZE, SIZE), interpolation=cv2.INTER_AREA if side > SIZE else cv2.INTER_CUBIC)
    a = np.clip(small[..., 3:], 0, 1)
    rgba = np.dstack([np.clip(small[..., :3] / np.maximum(a, 1e-3), 0, 1), a])
    token = Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA')
    token.save(f'{out}/token-{name}.png')
    token.save(f'{out}/{name}.webp', quality=92, method=6)

    debug = Image.fromarray((image * 255).astype(np.uint8))
    ImageDraw.Draw(debug).line(hull_points + hull_points[:1], fill=(255, 0, 0), width=2)
    debug.save(f'{out}/hull-{name}.png')
    print(name, 'upscaled', (width, height), 'weapon', (right - left, bottom - top), '->', SIZE, flush=True)
    return token


def sheet(tokens, out):
    """The four tokens on card paper, for checking by eye."""
    cell = SIZE
    page = Image.new('RGB', (cell * 2, cell * 2), (236, 230, 216))
    for i, token in enumerate(tokens.values()):
        page.paste(token, ((i % 2) * cell, (i // 2) * cell), token)
    page.save(f'{out}/sheet.png')


if __name__ == '__main__':
    models, src, out = sys.argv[1:4]
    only = sys.argv[4:] or list(SPECS)
    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    nets = {
        'general': load(f'{models}/RealESRGAN_x4plus.pth', 23, device),
        'anime': load(f'{models}/RealESRGAN_x4plus_anime_6B.pth', 6, device),
    }
    tokens = {name: build(name, SPECS[name], nets, device, src, out) for name in only}
    if len(tokens) == 4:
        sheet(tokens, out)
