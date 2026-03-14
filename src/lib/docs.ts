import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export interface DocHeading {
  depth: number;
  text: string;
  id: string;
}

export interface DocMeta {
  slug: string;
  title: string;
  description: string;
  visibility: 'public' | 'private' | 'both';
  category: string;
  order: number;
  readingTime: number;
}

export interface DocPage extends DocMeta {
  content: string;
  headings: DocHeading[];
}

const DOCS_DIR = path.join(process.cwd(), 'src', 'content', 'docs');

function ensureDocsDir() {
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }
}

function calculateReadingTime(content: string): number {
  const text = content
    .replace(/<[^>]*>/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

function extractHeadings(content: string): DocHeading[] {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings: DocHeading[] = [];
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    const text = match[2]
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .trim();
    const id = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-');
    headings.push({
      depth: match[1].length,
      text,
      id,
    });
  }

  return headings;
}

export function getAllDocs(filter?: 'public' | 'private'): DocMeta[] {
  ensureDocsDir();

  const files = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.mdx') || f.endsWith('.md'));

  const docs: DocMeta[] = files.map(file => {
    const raw = fs.readFileSync(path.join(DOCS_DIR, file), 'utf-8');
    const { data, content } = matter(raw);
    const slug = file.replace(/\.mdx?$/, '');

    return {
      slug,
      title: data.title || slug,
      description: data.description || '',
      visibility: data.visibility || 'both',
      category: data.category || 'general',
      order: data.order ?? 99,
      readingTime: calculateReadingTime(content),
    };
  });

  const filtered = filter
    ? docs.filter(d => d.visibility === filter || d.visibility === 'both')
    : docs;

  return filtered.sort((a, b) => a.order - b.order);
}

export function getDocBySlug(slug: string): DocPage | null {
  ensureDocsDir();

  const safeName = slug.replace(/[^a-zA-Z0-9_-]/g, '');
  const mdxPath = path.join(DOCS_DIR, `${safeName}.mdx`);
  const mdPath = path.join(DOCS_DIR, `${safeName}.md`);

  const filePath = fs.existsSync(mdxPath) ? mdxPath : fs.existsSync(mdPath) ? mdPath : null;
  if (!filePath) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);

  return {
    slug: safeName,
    title: data.title || safeName,
    description: data.description || '',
    visibility: data.visibility || 'both',
    category: data.category || 'general',
    order: data.order ?? 99,
    readingTime: calculateReadingTime(content),
    content,
    headings: extractHeadings(content),
  };
}
