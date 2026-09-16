export function pushTriangleVertex(
  vertices: number[],
  x: number,
  y: number,
  color: [number, number, number, number],
) {
  vertices.push(x, y, color[0], color[1], color[2], color[3]);
}

export function pushRectTriangles(
  vertices: number[],
  x: number,
  y: number,
  width: number,
  height: number,
  color: [number, number, number, number],
) {
  const right = x + width;
  const bottom = y + height;

  pushTriangleVertex(vertices, x, y, color);
  pushTriangleVertex(vertices, right, y, color);
  pushTriangleVertex(vertices, x, bottom, color);
  pushTriangleVertex(vertices, x, bottom, color);
  pushTriangleVertex(vertices, right, y, color);
  pushTriangleVertex(vertices, right, bottom, color);
}

export function pushLineSegmentTriangles(
  vertices: number[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  color: [number, number, number, number],
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);

  if (!length) {
    return;
  }

  const offsetX = (-dy / length) * (width / 2);
  const offsetY = (dx / length) * (width / 2);
  const ax = x1 + offsetX;
  const ay = y1 + offsetY;
  const bx = x1 - offsetX;
  const by = y1 - offsetY;
  const cx = x2 + offsetX;
  const cy = y2 + offsetY;
  const dx2 = x2 - offsetX;
  const dy2 = y2 - offsetY;

  pushTriangleVertex(vertices, ax, ay, color);
  pushTriangleVertex(vertices, bx, by, color);
  pushTriangleVertex(vertices, cx, cy, color);
  pushTriangleVertex(vertices, cx, cy, color);
  pushTriangleVertex(vertices, bx, by, color);
  pushTriangleVertex(vertices, dx2, dy2, color);
}

export function pushFillSegmentTriangles(
  vertices: number[],
  x1: number,
  upperY1: number,
  lowerY1: number,
  x2: number,
  upperY2: number,
  lowerY2: number,
  color: [number, number, number, number],
) {
  pushTriangleVertex(vertices, x1, upperY1, color);
  pushTriangleVertex(vertices, x1, lowerY1, color);
  pushTriangleVertex(vertices, x2, upperY2, color);
  pushTriangleVertex(vertices, x2, upperY2, color);
  pushTriangleVertex(vertices, x1, lowerY1, color);
  pushTriangleVertex(vertices, x2, lowerY2, color);
}

export function pushTriangleMarker(
  vertices: number[],
  x: number,
  y: number,
  size: number,
  up: boolean,
  color: [number, number, number, number],
) {
  const half = size / 2;
  const tipY = up ? y - half : y + half;
  const baseY = up ? y + half : y - half;

  pushTriangleVertex(vertices, x, tipY, color);
  pushTriangleVertex(vertices, x - half, baseY, color);
  pushTriangleVertex(vertices, x + half, baseY, color);
}

export function pushDashedLineSegmentTriangles(
  vertices: number[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  color: [number, number, number, number],
  dashLength: number,
  gapLength: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);

  if (!length) {
    return;
  }

  const resolvedDashLength = Math.max(width, dashLength);
  const resolvedGapLength = Math.max(0, gapLength);
  const stepX = dx / length;
  const stepY = dy / length;
  let cursor = 0;

  while (cursor < length) {
    const segmentStart = cursor;
    const segmentEnd = Math.min(length, segmentStart + resolvedDashLength);

    pushLineSegmentTriangles(
      vertices,
      x1 + stepX * segmentStart,
      y1 + stepY * segmentStart,
      x1 + stepX * segmentEnd,
      y1 + stepY * segmentEnd,
      width,
      color,
    );

    cursor += resolvedDashLength + resolvedGapLength;
  }
}
