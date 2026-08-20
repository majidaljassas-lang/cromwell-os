/**
 * Renders the source PDF for an IntakeDocument inside an iframe.
 *
 * Backed by GET /api/intake-documents/[id]/file which fetches the original
 * Outlook attachment on demand and caches it to disk.
 */
export function SourcePdfPreview({
  intakeDocumentId,
  className,
}: {
  intakeDocumentId: string | null;
  className?: string;
}) {
  if (!intakeDocumentId) {
    return (
      <div className="text-[11px] text-[#888888] bb-mono p-4 bg-[#0A0A0A] border border-[#2A2A2A]">
        No source document.
      </div>
    );
  }

  return (
    <div className={`bg-[#0A0A0A] border border-[#2A2A2A] ${className ?? "h-[800px]"}`}>
      <iframe
        src={`/api/intake-documents/${intakeDocumentId}/file`}
        className="w-full h-full border-0"
        title="Source PDF"
      />
    </div>
  );
}
