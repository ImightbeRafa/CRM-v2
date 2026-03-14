'use client';

import React from 'react';
import { SearchDocsWrapper } from '@/app/components/docs/SearchDocs';
import type { DocMeta } from '@/lib/docs';

interface HelpIndexClientProps {
  docs: DocMeta[];
}

export function HelpIndexClient({ docs }: HelpIndexClientProps) {
  return (
    <div className="max-w-md mx-auto mb-8">
      <SearchDocsWrapper docs={docs} basePath="/help" />
    </div>
  );
}
