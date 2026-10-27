"""Рисует значки приложения в docs/icons (цвета темы «Тёмная уютная»)."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "docs" / "icons"
BG, ACTION, GOOD = "#171a26", "#5a4a8a", "#8fd6a0"


def draw(size, maskable):
    s = 4  # рисуем крупнее и уменьшаем — так края гладкие
    n = size * s
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, n, n], fill=ACTION)
        k = 0.62  # знак внутри «безопасной» зоны
    else:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=n * 0.22, fill=ACTION)
        k = 0.8
    c, r = n / 2, n / 2 * k * 0.72
    w = max(2, int(n * 0.055 * k))
    d.ellipse([c - r, c - r, c + r, c + r], outline=GOOD, width=w)
    pts = [(c - r * 0.45, c + r * 0.02), (c - r * 0.1, c + r * 0.36), (c + r * 0.5, c - r * 0.32)]
    d.line(pts, fill=GOOD, width=int(w * 1.3), joint="curve")
    for x, y in (pts[0], pts[-1]):
        h = w * 0.65
        d.ellipse([x - h, y - h, x + h, y + h], fill=GOOD)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
draw(192, False).save(OUT / "icon-192.png")
draw(512, False).save(OUT / "icon-512.png")
draw(512, True).save(OUT / "maskable-512.png")
print("ok")
