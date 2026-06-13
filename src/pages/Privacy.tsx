import { For, type JSX } from "solid-js";
import { DocModal } from "../components/DocModal";

/** Bump this when the substance of the policy changes; surfaced to the reader. */
export const PRIVACY_LAST_UPDATED = "June 13, 2026";

type Section = { heading: string; body: JSX.Element; };

// Generic policy whose throughline is that the Service is public and content
// submitted to it is not private.
const SECTIONS: Section[] = [
  {
    heading: "1. No expectation of privacy",
    body: (
      <p>
        This Privacy Policy describes how Grindshell, LLC ("we", "us", or "Grindshell") handles
        information in connection with the Grindshell service (the "Service"). Read it together
        with our Terms of Service.{" "}
        <strong class="text-base-content">
          The Service is a public, multiplayer game and you should have no expectation of privacy in
          what you do or say on it.
        </strong>{" "}
        Content you submit — including chat, direct messages, names, and gameplay activity — is not
        private and may be viewed by our staff, retained, and disclosed as described below.
      </p>
    ),
  },
  {
    heading: "2. Information we collect",
    body: (
      <>
        <p>We collect:</p>
        <ul class="list-disc list-inside mt-2 space-y-1 text-base-content/70">
          <li>
            <strong class="text-base-content">Account information</strong> — your username, password
            (stored only in hashed form), and, if you provide it, your email address.
          </li>
          <li>
            <strong class="text-base-content">Content you submit</strong> — chat messages (public
            and direct), names, and other materials you send through the Service.
          </li>
          <li>
            <strong class="text-base-content">Gameplay data</strong> — your characters, progress,
            inventory, market activity, and related game state.
          </li>
          <li>
            <strong class="text-base-content">Technical data</strong> — information your client and
            connection provide in the course of operating the Service.
          </li>
        </ul>
      </>
    ),
  },
  {
    heading: "3. How we use information",
    body: (
      <p>
        We use the information we collect to operate, maintain, and improve the Service; to create
        and secure accounts; to enable gameplay and communication between players; to enforce our
        Terms of Service and moderate the Service; to protect against fraud, abuse, and security
        threats; and to comply with our legal obligations.
      </p>
    ),
  },
  {
    heading: "4. Content is public, not private",
    body: (
      <p>
        Chat, direct messages, names, and other content you submit are{" "}
        <strong class="text-base-content">not private</strong>. They may be read by other users
        (where applicable), reviewed by our moderators and staff at any time, retained, and used as
        permitted by our Terms of Service. Do not submit anything through the Service that you would
        not want recorded, reviewed, retained, or disclosed.
      </p>
    ),
  },
  {
    heading: "5. Disclosure to third parties",
    body: (
      <p>
        We do not sell your personal information. We may disclose information to service providers
        who help us operate the Service, and{" "}
        <strong class="text-base-content">
          we will cooperate with valid law enforcement requests
        </strong>{" "}
        and may disclose information and content where we believe in good faith that doing so is
        required by law, legal process, or to protect the rights, safety, or property of Grindshell,
        our users, or the public. We may also transfer information in connection with a merger,
        acquisition, or sale of assets.
      </p>
    ),
  },
  {
    heading: "6. Data retention and deletion",
    body: (
      <p>
        You may request deletion of your account data and chat logs by contacting us (see "Contact"
        below). On such a request, your chat and message logs will be{" "}
        <strong class="text-base-content">scrubbed</strong> — the message content and your
        association as author are removed, while the underlying message identifier remains valid for
        the integrity of the Service.{" "}
        <strong class="text-base-content">
          Where your chat logs have resulted in action being taken against your account
        </strong>{" "}
        (such as a warning, suspension, or ban), those logs are retained — even after account
        deletion — to protect the Service and its users against abuse. We may also retain
        information as required to comply with our legal obligations.
      </p>
    ),
  },
  {
    heading: "7. Security",
    body: (
      <p>
        We take reasonable measures to protect information, but no method of transmission or storage
        is completely secure. We cannot guarantee the absolute security of your information, and you
        use the Service at your own risk.
      </p>
    ),
  },
  {
    heading: "8. Children",
    body: (
      <p>
        The Service is intended only for people who are at least 18 years of age. We do not
        knowingly collect information from anyone under 18. If we learn that we have collected
        information from a person under 18, we will delete it and terminate the associated account.
      </p>
    ),
  },
  {
    heading: "9. International users",
    body: (
      <p>
        Grindshell, LLC is based in the State of Georgia, USA, and information we process is handled
        in the United States. By using the Service, you understand that your information will be
        processed in the United States, which may have data-protection laws different from those in
        your country.
      </p>
    ),
  },
  {
    heading: "10. Changes to this Policy",
    body: (
      <p>
        We may update this Privacy Policy from time to time. When we do, we will update the "last
        updated" date above. Your continued use of the Service after changes take effect constitutes
        your acceptance of the revised Policy.
      </p>
    ),
  },
  {
    heading: "11. Contact",
    body: (
      <p>
        Questions about this Privacy Policy can be directed to Grindshell, LLC at{" "}
        <a class="text-primary hover:underline" href="mailto:support@grindshell.com">
          support@grindshell.com
        </a>
        .
      </p>
    ),
  },
];

/** The Privacy Policy document body — reused by the route and the modal. */
export function PrivacyDocument() {
  return (
    <article class="prose-sm max-w-none text-sm leading-relaxed text-base-content/80 space-y-5">
      <p class="text-xs text-base-content/45">Last updated: {PRIVACY_LAST_UPDATED}</p>
      <For each={SECTIONS}>
        {(s) => (
          <section class="space-y-2">
            <h2 class="text-base font-semibold text-base-content mb-1">{s.heading}</h2>
            {s.body}
          </section>
        )}
      </For>
    </article>
  );
}

/** In-app route view (rendered inside the authed shell, linked from About). */
export function Privacy() {
  return (
    <section class="size-full max-w-3xl" data-screen-label="Privacy Policy">
      <header class="flex items-baseline gap-3 mb-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Privacy Policy</h1>
        <span class="text-xs text-base-content/45">// what we collect and why</span>
      </header>
      <PrivacyDocument />
    </section>
  );
}

/** Overlay viewer for the login gate (outside the router). */
export function PrivacyModal(props: { onClose: () => void; }) {
  return (
    <DocModal title="Privacy Policy" onClose={props.onClose}>
      <PrivacyDocument />
    </DocModal>
  );
}
