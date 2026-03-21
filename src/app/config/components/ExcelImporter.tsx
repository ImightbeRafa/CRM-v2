'use client';

import { Card, CardContent } from '@/app/components/ui/card';
import { FileSpreadsheet, Mail, ArrowRight } from 'lucide-react';

const SUPPORT_EMAIL = 'support@betsycrm.com';

export function ExcelImporter() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-col items-center text-center px-6 py-12 sm:py-16">
          <div className="p-4 rounded-2xl bg-primary/10 mb-5">
            <FileSpreadsheet className="w-8 h-8 text-primary" />
          </div>

          <h2 className="text-xl font-semibold text-foreground mb-2">
            Importar datos
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mb-8 leading-relaxed">
            Si necesitás migrar datos desde Excel, otro sistema o cualquier otra fuente,
            nuestro equipo te ayuda con el proceso para que todo quede correcto.
          </p>

          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=Solicitud de importación de datos`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Mail className="w-4 h-4" />
            Contactar soporte
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
          <span className="text-xs text-muted-foreground mt-3">{SUPPORT_EMAIL}</span>
        </div>
      </CardContent>
    </Card>
  );
}
