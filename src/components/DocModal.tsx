import { type JSX } from "solid-js";

/**
 * Shared scrollable overlay for legal documents (Terms, Privacy) shown on the
 * login gate, which lives outside the router and so can't use a route view.
 */
export function DocModal(props: { title: string; onClose: () => void; children: JSX.Element }) {
  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      onClick={(e) => {
        if (e.currentTarget === e.target) props.onClose();
      }}
    >
      <div class="card bg-base-200 shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div class="flex items-center justify-between px-6 py-4 border-b border-base-300">
          <h2 class="text-lg font-mono tracking-tight">{props.title}</h2>
          <button
            class="btn btn-sm btn-ghost btn-circle text-lg"
            aria-label="Close"
            onClick={() => props.onClose()}
          >
            ✕
          </button>
        </div>
        <div class="overflow-y-auto px-6 py-5">{props.children}</div>
      </div>
    </div>
  );
}
