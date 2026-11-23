"""Draws the SE Grid Builder logo: the letters "GB" built from cubes, with the
front of each letter flat and readable and the blocks extruded back at a 30
degree angle (an "almost isometric" look), in front of a faint build grid.

Run:  python branding/make_logo.py
Makes: branding/logo.svg (any size) and branding/logo.png (1024x1024, for `tauri icon`).

The letters are plain cubes in the app's own colors. Nothing here comes from the
game: no block icons, no game artwork.
"""

import math
import os

from PIL import Image, ImageChops, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SIZE = 1024  # the picture is SIZE x SIZE
CORNER = 0.2  # rounded-corner radius as a fraction of SIZE

# Each letter is a picture made of blocks: "#" is a block, "." is empty. Top row first.
LETTERS = {
    "G": [
        ".###",
        "#...",
        "#.##",
        "#..#",
        ".###",
    ],
    "B": [
        "###.",
        "#..#",
        "###.",
        "#..#",
        "###.",
    ],
}
WORD = "GB"
GAP = 1  # empty cells between letters
DEPTH = 1.0  # how many cells deep the blocks are
SLANT = 0.55  # how far one cell of depth moves the drawing, as a fraction of a cell

# Colors (the app's dark theme and blue accent).
BACKGROUND = "#14161c"
GRID_LINE = (110, 168, 255, 46)  # faint blue, so the background reads as "the build grid"
FRONT = "#5b9bf0"
TOP = "#a9cfff"
SIDE = "#3566b0"
EDGE = "#14161c"  # thin dark outline so each block reads as its own piece
COLORS = {"front": FRONT, "top": TOP, "side": SIDE}


def build_cells():
    """Every block as (column, row from the bottom), plus the drawing's width and height in cells."""
    cells = []
    left = 0
    height = 0
    for index, letter in enumerate(WORD):
        rows = LETTERS[letter]
        height = max(height, len(rows))
        for row_from_top, line in enumerate(rows):
            for column, mark in enumerate(line):
                if mark == "#":
                    cells.append((left + column, len(rows) - 1 - row_from_top))
        left += len(rows[0]) + (GAP if index < len(WORD) - 1 else 0)
    return cells, left, height


class Projection:
    """Across is straight right, up is straight up, and depth goes back up-and-right at 30 degrees."""

    def __init__(self, cell_size, origin_x, origin_y):
        self.cell = cell_size
        self.origin = (origin_x, origin_y)
        self.back = (
            cell_size * SLANT * math.cos(math.radians(30)) * 2,
            -cell_size * SLANT * math.sin(math.radians(30)) * 2,
        )

    def point(self, x, y, z):
        """Screen position of a point: x along the letters, y up, z into the picture."""
        return (
            self.origin[0] + x * self.cell + z * self.back[0],
            self.origin[1] - y * self.cell + z * self.back[1],
        )


def cube_faces(projection, x, y):
    """The three visible faces of the block at (x, y): (name, corner points)."""
    p = projection.point
    d = DEPTH
    return [
        ("front", [p(x, y, 0), p(x + 1, y, 0), p(x + 1, y + 1, 0), p(x, y + 1, 0)]),
        ("top", [p(x, y + 1, 0), p(x + 1, y + 1, 0), p(x + 1, y + 1, d), p(x, y + 1, d)]),
        ("side", [p(x + 1, y, 0), p(x + 1, y, d), p(x + 1, y + 1, d), p(x + 1, y + 1, 0)]),  # the right end
    ]


def layout():
    """The faces in painting order, the grid lines, and the cell size in pixels."""
    cells, width, height = build_cells()
    # Fit the letters, with their depth, into about 80% of the picture's width.
    extra = DEPTH * SLANT * math.cos(math.radians(30)) * 2
    cell_size = 0.80 * SIZE / (width + extra)
    extra_up = DEPTH * SLANT * math.sin(math.radians(30)) * 2
    total_width = (width + extra) * cell_size
    total_height = (height + extra_up) * cell_size
    projection = Projection(
        cell_size,
        (SIZE - total_width) / 2,
        (SIZE + total_height) / 2,
    )
    # Left to right, bottom to top: a block's right end and top are then covered by its
    # neighbors' fronts, the way they would be seen.
    faces = []
    for x, y in sorted(cells):
        faces.extend(cube_faces(projection, x, y))

    # The grid sits behind the letters: the plane at the back of the blocks.
    lines = []
    back_x, back_y = projection.back[0] * DEPTH, projection.back[1] * DEPTH
    first_column = -int(projection.origin[0] // cell_size) - 2
    last_column = int((SIZE - projection.origin[0]) // cell_size) + 3
    for column in range(first_column, last_column):
        x = projection.origin[0] + back_x + column * cell_size
        lines.append(((x, 0), (x, SIZE)))
    first_row = -int((SIZE - (projection.origin[1] + back_y)) // cell_size) - 2
    last_row = int((projection.origin[1] + back_y) // cell_size) + 3
    for row in range(first_row, last_row):
        y = projection.origin[1] + back_y - row * cell_size
        lines.append(((0, y), (SIZE, y)))
    return faces, lines, cell_size


def write_svg(path, faces, lines, cell_size):
    def points(corners):
        return " ".join(f"{x:.1f},{y:.1f}" for x, y in corners)

    radius = SIZE * CORNER
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}" width="{SIZE}" height="{SIZE}">',
        "<title>SE Grid Builder</title>",
        f'<defs><clipPath id="icon"><rect width="{SIZE}" height="{SIZE}" rx="{radius:.0f}"/></clipPath></defs>',
        '<g clip-path="url(#icon)">',
        f'<rect width="{SIZE}" height="{SIZE}" fill="{BACKGROUND}"/>',
        f'<g stroke="rgb{GRID_LINE[:3]}" stroke-opacity="{GRID_LINE[3] / 255:.2f}" stroke-width="3">',
    ]
    for (x1, y1), (x2, y2) in lines:
        parts.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}"/>')
    parts.append("</g>")
    parts.append(f'<g stroke="{EDGE}" stroke-width="{max(3, cell_size * 0.05):.1f}" stroke-linejoin="round">')
    for name, corners in faces:
        parts.append(f'<polygon points="{points(corners)}" fill="{COLORS[name]}"/>')
    parts.append("</g></g></svg>")
    with open(path, "w", encoding="utf-8") as file:
        file.write("\n".join(parts))


def write_png(path, faces, lines, cell_size):
    """Draws at 2x and shrinks, which smooths the edges."""
    scale = 2
    full = SIZE * scale
    picture = Image.new("RGBA", (full, full), BACKGROUND)

    # The faint grid goes on its own layer, then is blended on (drawing a see-through
    # color straight onto the picture would replace the pixels instead of blending).
    floor = Image.new("RGBA", (full, full), (0, 0, 0, 0))
    floor_draw = ImageDraw.Draw(floor)
    for (x1, y1), (x2, y2) in lines:
        floor_draw.line([(x1 * scale, y1 * scale), (x2 * scale, y2 * scale)], fill=GRID_LINE, width=3 * scale)
    picture = Image.alpha_composite(picture, floor)

    draw = ImageDraw.Draw(picture)
    edge_width = max(3, int(cell_size * 0.05 * scale))
    for name, corners in faces:
        scaled = [(x * scale, y * scale) for x, y in corners]
        draw.polygon(scaled, fill=COLORS[name])
        draw.line(scaled + [scaled[0]], fill=EDGE, width=edge_width, joint="curve")

    # Round the corners: keep only what is inside the rounded square.
    mask = Image.new("L", (full, full), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, full - 1, full - 1], radius=int(full * CORNER), fill=255)
    picture.putalpha(ImageChops.multiply(picture.getchannel("A"), mask))
    picture.resize((SIZE, SIZE), Image.LANCZOS).save(path)


if __name__ == "__main__":
    faces, lines, cell_size = layout()
    write_svg(os.path.join(HERE, "logo.svg"), faces, lines, cell_size)
    write_png(os.path.join(HERE, "logo.png"), faces, lines, cell_size)
    print("wrote branding/logo.svg and branding/logo.png")
