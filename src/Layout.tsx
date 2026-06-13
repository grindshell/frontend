import { Show, createSignal, type ParentProps } from "solid-js";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { ChatPanel } from "./components/ChatPanel";

// The persistent app shell and the router `root`. The matched route renders
// into the content area via props.children; the sidebar, topbar, and chat
// panel stay mounted across navigation.
export function Layout(props: ParentProps) {
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  // The mobile off-canvas drawer is separate from the desktop collapse state:
  // on mobile the rail is hidden by default and slides in over the content.
  const [mobileNavOpen, setMobileNavOpen] = createSignal(false);
  const [showChat, setShowChat] = createSignal(true);
  // Vertical split between the screen content and the chat panel (percent of height).
  const [contentPct, setContentPct] = createSignal(72);

  const startChatResize = (e: MouseEvent) => {
    const parent = (e.currentTarget as HTMLElement).parentElement;
    if (!parent) return;
    const startY = e.clientY;
    const startPct = contentPct();
    const total = parent.getBoundingClientRect().height;
    const move = (ev: MouseEvent) => {
      const delta = ((ev.clientY - startY) / total) * 100;
      setContentPct(Math.min(85, Math.max(20, startPct + delta)));
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  return (
    <div class="h-screen flex bg-base-100 text-base-content overflow-hidden">
      {/* Mobile drawer backdrop: tap to dismiss. Desktop never renders it. */}
      <Show when={mobileNavOpen()}>
        <div
          class="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      </Show>
      <Sidebar
        open={sidebarOpen()}
        setOpen={setSidebarOpen}
        mobileOpen={mobileNavOpen()}
        closeMobile={() => setMobileNavOpen(false)}
      />
      <div class="flex-1 flex flex-col min-w-0">
        <TopBar
          showChat={showChat()}
          onToggleChat={() => setShowChat(!showChat())}
          onOpenNav={() => setMobileNavOpen(true)}
        />
        <div class="flex-1 flex flex-col min-h-0">
          <div
            class="overflow-y-auto p-4"
            style={
              showChat()
                ? { "flex-basis": `${contentPct()}%`, "flex-grow": "0", "flex-shrink": "0" }
                : { "flex-grow": "1", "flex-shrink": "1", "flex-basis": "0%" }
            }
          >
            {props.children}
          </div>
          <Show when={showChat()}>
            <div
              class="h-0.5 bg-base-content/20 hover:bg-primary cursor-row-resize shrink-0"
              onMouseDown={startChatResize}
            />
            <div class="flex-1 min-h-0">
              <ChatPanel onCollapse={() => setShowChat(false)} />
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
