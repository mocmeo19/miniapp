"""Generate Miniapp Studio's desktop icons from its four-tile brand mark."""

from pathlib import Path
import shutil

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
RESOURCES = ROOT / "resources"
SIZE = 1024
SCALE = 4


def make_icon() -> Image.Image:
    size = SIZE * SCALE
    icon = Image.new("RGBA", (size, size))

    # A soft raised tile leaves the purple mark legible at dock and taskbar sizes.
    shadow = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(shadow)
    draw.rounded_rectangle((76 * SCALE, 82 * SCALE, 948 * SCALE, 954 * SCALE),
                           radius=208 * SCALE, fill=(49, 27, 116, 55))
    icon.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(28 * SCALE)))

    background = Image.new("RGBA", (size, size))
    pixels = background.load()
    for y in range(size):
        blend = y / (size - 1)
        color = (round(250 - 19 * blend), round(248 - 25 * blend),
                 round(255 - 2 * blend), 255)
        for x in range(size):
            pixels[x, y] = color
    mask = Image.new("L", (size, size))
    ImageDraw.Draw(mask).rounded_rectangle(
        (64 * SCALE, 64 * SCALE, 960 * SCALE, 960 * SCALE),
        radius=208 * SCALE, fill=255)
    background.putalpha(mask)
    icon.alpha_composite(background)

    border = ImageDraw.Draw(icon)
    border.rounded_rectangle((66 * SCALE, 66 * SCALE, 958 * SCALE, 958 * SCALE),
                             radius=206 * SCALE, outline=(116, 81, 239, 24),
                             width=4 * SCALE)

    mark = Image.new("RGBA", (size, size))
    tiles = ImageDraw.Draw(mark)
    tile_size = 230 * SCALE
    gap = 58 * SCALE
    left = (size - (2 * tile_size + gap)) // 2
    top = left
    colors = ["#7551ef", "#ae98fa", "#987cf4", "#4e31ca"]
    for row in range(2):
        for col in range(2):
            x = left + col * (tile_size + gap)
            y = top + row * (tile_size + gap)
            tiles.rounded_rectangle((x, y, x + tile_size, y + tile_size),
                                    radius=55 * SCALE, fill=colors[row * 2 + col])
    mark = mark.rotate(11, resample=Image.Resampling.BICUBIC)
    icon.alpha_composite(mark)
    return icon.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def main() -> None:
    icon = make_icon()
    png = RESOURCES / "icon.png"
    icon.save(png, optimize=True)
    icon.save(RESOURCES / "icon.ico", format="ICO",
              sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    public = ROOT / "src/renderer/public"
    public.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(png, public / "icon.png")

    icon.save(RESOURCES / "icon.icns", format="ICNS")


if __name__ == "__main__":
    main()
