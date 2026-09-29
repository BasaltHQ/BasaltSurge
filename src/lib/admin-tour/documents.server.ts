import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { compileTourDocuments } from './documents';

/** Discover source documents at runtime. No panel imports, generated manifest, or agent upload. */
export async function loadTourCatalog(root = join(process.cwd(), 'docs', 'tour', 'panels')) {
  async function discover(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const paths = await Promise.all(entries.map(entry => entry.isDirectory()
      ? discover(join(directory, entry.name))
      : entry.isFile() && entry.name.endsWith('.md') ? [join(directory, entry.name)] : []));
    return paths.flat().sort();
  }
  const paths = await discover(root);
  if (!paths.length) throw new Error('No tour panel guides were found.');
  const documents = await Promise.all(paths.map(async path => ({ markdown: await readFile(path, 'utf8'),
    href: `/developers/docs/tour/panels/${relative(root, path).slice(0, -3).split(sep).map(encodeURIComponent).join('/')}` })));
  return compileTourDocuments(documents);
}
