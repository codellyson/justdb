const partsOf = (path: string) => path.replace(/\\/g, '/').split('/').filter(Boolean);

/** Show a unique path suffix without letting generated D1 internals dominate. */
export function localPathLabel(path: string, paths: string[]): string {
  const parts = partsOf(path);
  const others = paths.filter(other => other !== path).map(partsOf);
  let count = Math.min(2, parts.length);
  while (count < parts.length && others.some(other => other.slice(-count).join('/') === parts.slice(-count).join('/'))) count++;
  let label = count < parts.length ? `…/${parts.slice(-count).join('/')}` : path;
  const file = parts.at(-1) ?? '';
  if (/^[a-f0-9]{32,}\.sqlite$/i.test(file)) {
    const hash = file.slice(0, -7);
    let prefix = 8;
    const otherFiles = others.map(other => other.at(-1) ?? '').filter(other => other !== file);
    while (prefix < hash.length - 8 && otherFiles.some(other => other.startsWith(hash.slice(0, prefix)) && other.endsWith(`${hash.slice(-8)}.sqlite`))) prefix += 4;
    const short = prefix < hash.length - 8 ? `${hash.slice(0, prefix)}…${hash.slice(-8)}.sqlite` : file;
    label = label.slice(0, -file.length) + short;
    label = label.replace(/(?:\.wrangler\/state\/v3\/d1\/)?miniflare-D1DatabaseObject\//, '');
  }
  return label;
}
