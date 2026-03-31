"use client";

import { Button } from "@/components/ui/button";
import { FileDown } from "lucide-react";
import { downloadTemplate } from "@/components/import-excel-dialog";

export function ExportTemplateButton() {
  return (
    <Button
      type="button"
      variant="outline"
      className="gap-1.5 shadow-xs"
      onClick={downloadTemplate}
    >
      <FileDown className="h-4 w-4" />
      下载导入模板
    </Button>
  );
}
