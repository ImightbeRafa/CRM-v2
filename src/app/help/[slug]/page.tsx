import { notFound } from 'next/navigation';
import { serialize } from 'next-mdx-remote/serialize';
import remarkGfm from 'remark-gfm';
import { getDocBySlug, getAllDocs } from '@/lib/docs';
import { DocRenderer } from '@/app/components/DocRenderer';
import { DocsShell } from '@/app/components/docs/DocsShell';
import { TableOfContents } from '@/app/components/docs/TableOfContents';
import { DocsPagination } from '@/app/components/docs/DocsPagination';
import { DocsBreadcrumb } from '@/app/components/docs/DocsBreadcrumb';

export const dynamic = 'force-dynamic';

export default async function HelpPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDocBySlug(slug);

  if (!doc || doc.visibility === 'public') {
    notFound();
  }

  const allDocs = getAllDocs('private');
  const mdxSource = await serialize(doc.content, {
    mdxOptions: { remarkPlugins: [remarkGfm] },
  });

  return (
    <DocsShell
      docs={allDocs}
      currentSlug={slug}
      basePath="/help"
      rightSidebar={<TableOfContents headings={doc.headings} />}
    >
      <DocsBreadcrumb
        basePath="/help"
        baseLabel="Centro de Ayuda"
        category={doc.category}
        title={doc.title}
      />
      <DocRenderer
        source={mdxSource}
        title={doc.title}
        description={doc.description}
        category={doc.category}
        readingTime={doc.readingTime}
      />
      <DocsPagination
        docs={allDocs}
        currentSlug={slug}
        basePath="/help"
      />
    </DocsShell>
  );
}
