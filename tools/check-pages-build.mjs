import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = path.join(root, 'public');
const distRoot = path.join(root, 'dist');

async function listFiles(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath, base) : path.relative(base, entryPath);
  }));
  return files.flat().sort();
}

const publicFiles = await listFiles(publicRoot);
const metadataFiles = publicFiles.filter((file) => path.basename(file) === '.DS_Store');
if (metadataFiles.length) {
  throw new Error(`macOS metadata must not be deployed: ${metadataFiles.join(', ')}`);
}

const distFiles = await listFiles(distRoot);
const distFileSet = new Set(distFiles);
const missingFiles = publicFiles.filter((file) => !distFileSet.has(file));
if (missingFiles.length) {
  throw new Error(`public assets missing from dist: ${missingFiles.join(', ')}`);
}

const publicDirectories = new Set(publicFiles.map((file) => file.split(path.sep)[0]));
publicDirectories.add('assets');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const directoryPattern = [...publicDirectories].map(escapeRegExp).join('|');
const rootUrlPattern = new RegExp(`(^|[^.\\w:-])/(?:${directoryPattern})/`, 'm');
const urlPathPattern = "[^\"'`\\s)]+";
const assetUrlPattern = new RegExp(
  `(?:^|[^\\w:-])(?:\\./)?((?:${directoryPattern})/${urlPathPattern})`,
  'g',
);

for (const file of distFiles.filter((name) => /\.(?:css|html|js)$/.test(name))) {
  const contents = await readFile(path.join(distRoot, file), 'utf8');
  if (rootUrlPattern.test(contents)) {
    throw new Error(`root-absolute asset URL found in dist/${file}`);
  }
  for (const match of contents.matchAll(assetUrlPattern)) {
    if (!distFileSet.has(match[1])) {
      throw new Error(`asset referenced by dist/${file} is missing: ${match[1]}`);
    }
  }
}

console.log(`Pages build verified: ${publicFiles.length} public assets and no root-absolute asset URLs.`);
