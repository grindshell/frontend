import { Show, createSignal } from "solid-js";
import { Icon } from "./Icon";

const KEY = "grindshell.gdpr";

/** A one-time notice that the client stores data locally on this device. */
export function GdprConsent() {
  const [consented, setConsented] = createSignal(localStorage.getItem(KEY) !== null);

  const accept = () => {
    localStorage.setItem(KEY, "yes");
    setConsented(true);
  };

  return (
    <Show when={!consented()}>
      <div class="fixed p-2 bottom-0 left-1/2 -translate-x-1/2 z-10">
        <div role="alert" class="alert alert-vertical sm:alert-horizontal shadow-lg">
          <Icon name="InformationCircle" class="size-5" />
          <span class="text-sm">Playing Grindshell stores client data on your device.</span>
          <button class="btn btn-sm btn-primary" onClick={accept}>
            Okay
          </button>
        </div>
      </div>
    </Show>
  );
}
