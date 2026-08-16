export function publicAsset(path: string, base = import.meta.env?.BASE_URL ?? '/') {
  return `${base}${path.replace(/^\/+/, '')}`;
}
