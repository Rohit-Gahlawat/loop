"use client";

import { Button } from "@/components/ui/button";

/**
 * Export, without a PDF library.
 *
 * The page carries a print stylesheet, so the browser's own print dialogue
 * produces the shareable artefact: paper, or "Save as PDF" on every desktop
 * browser. Nothing is rendered twice, so what prints is exactly what was read.
 */
export function PrintButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      Print or save as PDF
    </Button>
  );
}
