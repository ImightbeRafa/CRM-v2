'use client';

import React from 'react';
import { SearchDocsWrapper } from '@/app/components/docs/SearchDocs';
import type { DocMeta } from '@/lib/docs';

interface DocsIndexClientProps {
  docs: DocMeta[];
}

export function DocsIndexClient({ docs }: DocsIndexClientProps) {
  return (
    <div className="max-w-md mx-auto mb-8">
      <SearchDocsWrapper docs={docs} basePath="/docs" />
    </div>
  );
}
