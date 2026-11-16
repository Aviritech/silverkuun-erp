import { formatDateTime } from "@/lib/format";
import { SIGNATURE_METHODS, SIGNER_ROLES } from "../constants";
import type { ESignature } from "../queries";

/** The e-signatures on a document or guarantee: the signature itself, who signed, as what, when, and who recorded it. */
export function SignatureList({ signatures, staffName }: { signatures: ESignature[]; staffName: (id: string | null) => string }) {
  if (signatures.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-3">
      {signatures.map((s) => (
        <li key={s.id} className="w-56 rounded-lg border border-zinc-200 bg-white p-2 text-xs text-zinc-600">
          {s.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL from private storage
            <img src={s.url} alt={`Signature of ${s.signer_name}`} className="h-14 w-full object-contain" />
          ) : (
            <div className="flex h-14 items-center justify-center text-zinc-400">Signature image not available</div>
          )}
          <div className="mt-1 border-t border-zinc-200 pt-1">
            <span className="block font-medium text-zinc-900">{s.signer_name}</span>
            <span className="block">
              {SIGNER_ROLES[s.signer_role].replace(" (yourself)", "")} · e-signed ({SIGNATURE_METHODS[s.method].toLowerCase()})
            </span>
            <span className="block">{formatDateTime(s.signed_at)}</span>
            {s.recorded_by !== s.signer_staff_id && <span className="block">Recorded by {staffName(s.recorded_by)}</span>}
            {s.document_sha256 && (
              <span className="block font-mono text-[10px] text-zinc-400" title={`SHA-256 of the document when signed: ${s.document_sha256}`}>
                Document fingerprint {s.document_sha256.slice(0, 12)}…
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
