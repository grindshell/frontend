import { For } from "solid-js";

type Item = { title: string; desc: string; url: string; };

const ITEMS: Item[] = [
  {
    title: "Source",
    desc: "Client (the thing you're using right now) source code.",
    url: "https://github.com/grindshell/frontend",
  },
  { title: "SolidJS", desc: "UI framework.", url: "https://github.com/solidjs/solid" },
  {
    title: "Solid Router",
    desc: "Client-side routing.",
    url: "https://github.com/solidjs/solid-router",
  },
  {
    title: "Tailwind CSS",
    desc: "CSS styling.",
    url: "https://github.com/tailwindlabs/tailwindcss",
  },
  {
    title: "daisyUI",
    desc: "Premade Tailwind CSS components.",
    url: "https://github.com/saadeghi/daisyui",
  },
  { title: "heroicons", desc: "Various SVG icons.", url: "https://heroicons.com/" },
  {
    title: "Tauri",
    desc: "Desktop versions of this client.",
    url: "https://github.com/tauri-apps/tauri",
  },
];

export function About() {
  return (
    <section class="size-full" data-screen-label="About">
      <header class="flex items-baseline gap-3 mb-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">About</h1>
        <span class="text-xs text-base-content/45">// what this client is built on</span>
      </header>
      <ul class="divide-y divide-base-300/60">
        <For each={ITEMS}>
          {({ title, desc, url }) => (
            <li class="py-3">
              <h2 class="text-lg font-medium">
                <a target="_blank" rel="noreferrer" href={url} class="hover:text-primary hover:underline">
                  {title}
                </a>
              </h2>
              <p class="text-sm text-base-content/60">{desc}</p>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}
