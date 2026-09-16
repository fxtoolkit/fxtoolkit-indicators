export function parseColor(
  cache: Map<string, [number, number, number, number]>,
  color: string,
  opacity = 1,
): [number, number, number, number] {
  const cacheKey = `${color}:${opacity}`;
  const cached = cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  let result: [number, number, number, number] = [1, 1, 1, opacity];

  if (color.startsWith("#")) {
    const normalized = color.slice(1);
    const expanded =
      normalized.length === 3
        ? normalized.split("").map((char) => char + char).join("")
        : normalized;

    if (expanded.length === 6 || expanded.length === 8) {
      const r = parseInt(expanded.slice(0, 2), 16) / 255;
      const g = parseInt(expanded.slice(2, 4), 16) / 255;
      const b = parseInt(expanded.slice(4, 6), 16) / 255;
      const a = expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1;
      result = [r, g, b, a * opacity];
    }
  } else {
    const rgbaMatch = color.match(
      /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i,
    );

    if (rgbaMatch) {
      const [, r, g, b, a] = rgbaMatch;
      result = [
        Number(r) / 255,
        Number(g) / 255,
        Number(b) / 255,
        (a ? Number(a) : 1) * opacity,
      ];
    }
  }

  cache.set(cacheKey, result);
  return result;
}
