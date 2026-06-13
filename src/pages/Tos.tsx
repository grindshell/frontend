import { For, type JSX } from "solid-js";
import { DocModal } from "../components/DocModal";

/** Bump this when the substance of the terms changes; surfaced to the reader. */
export const TOS_LAST_UPDATED = "June 13, 2026";

type Section = { heading: string; body: JSX.Element };

// The terms are deliberately generic; the callouts the project specifically
// wants are §5 (content license), §6 (chat retention / law enforcement), and
// §8 (termination for any reason).
const SECTIONS: Section[] = [
  {
    heading: "1. Acceptance of these Terms",
    body: (
      <p>
        Grindshell (the "Service") is operated by Grindshell, LLC ("we", "us", or "Grindshell").
        By creating an account of any kind — including a guest account — or by otherwise
        accessing or using the Service, you agree to be bound by these Terms of Service (the
        "Terms"). If you do not agree to these Terms, do not create an account and do not use the
        Service.
      </p>
    ),
  },
  {
    heading: "2. Eligibility",
    body: (
      <p>
        You must be at least 18 years of age to use the Service. By creating an account you
        represent and warrant that you are 18 or older. We do not knowingly permit anyone under 18
        to access or use the Service, and we may terminate any account we believe belongs to a
        person under 18. You are also responsible for ensuring that your use of the Service is
        lawful where you are located.
      </p>
    ),
  },
  {
    heading: "3. Accounts",
    body: (
      <p>
        You are responsible for any activity that occurs under your account and for keeping your
        credentials secure. Guest accounts may have reduced functionality and may be removed at
        any time. You may not share, sell, or transfer your account, and you may not create or use
        an account to impersonate another person or to evade a suspension or ban.
      </p>
    ),
  },
  {
    heading: "4. Acceptable use",
    body: (
      <>
        <p>You agree not to use the Service to:</p>
        <ul class="list-disc list-inside mt-2 space-y-1 text-base-content/70">
          <li>break any applicable law or infringe anyone's rights;</li>
          <li>
            harass, threaten, defraud, or harm other users, or post unlawful, abusive, or harmful
            content;
          </li>
          <li>
            cheat, exploit bugs, automate play, or otherwise interfere with the intended operation
            of the Service or with other players' enjoyment of it;
          </li>
          <li>
            attempt to gain unauthorized access to the Service, its accounts, or its underlying
            systems.
          </li>
        </ul>
      </>
    ),
  },
  {
    heading: "5. User content and license",
    body: (
      <p>
        The Service lets you submit content, including messages, chat (both public channels and
        direct messages), names, and other materials ("User Content"). You retain any ownership
        rights you have in your User Content. By submitting User Content, you grant Grindshell, LLC
        a{" "}
        <strong class="text-base-content">
          worldwide, perpetual, irrevocable, royalty-free, fully sublicensable and transferable
          license
        </strong>{" "}
        to use, host, store, reproduce, modify, adapt, publish, translate, distribute, publicly
        perform, and display your User Content, in whole or in part, in any media now known or
        later developed, in connection with operating, promoting, and improving the Service. This
        license survives termination of your account. You represent that you have the rights
        necessary to grant this license for the User Content you submit.
      </p>
    ),
  },
  {
    heading: "6. Chat, communications, and data retention",
    body: (
      <>
        <p>
          You may request deletion of your account data and chat logs at any time by contacting us
          (see "Contact" below). On such a request, your chat and message logs will be{" "}
          <strong class="text-base-content">scrubbed</strong> — the message content and your
          association as author are removed, while the underlying message identifier remains valid
          for the integrity of the Service.
        </p>
        <p>
          <strong class="text-base-content">
            The exception: where your chat logs have resulted in action being taken against your
            account
          </strong>{" "}
          (such as a warning, suspension, or ban), those logs will be retained — even after account
          deletion — to protect the Service and its users against abuse.
        </p>
        <p>
          <strong class="text-base-content">
            Grindshell, LLC will cooperate with valid law enforcement requests
          </strong>{" "}
          and may disclose your information and User Content where we believe in good faith that
          doing so is required by law, legal process, or to protect the rights, safety, or property
          of Grindshell, our users, or the public. Chat and other communications on the Service are
          not private; see our Privacy Policy.
        </p>
      </>
    ),
  },
  {
    heading: "7. Privacy",
    body: (
      <p>
        Using the Service stores client data on your device and processes account and gameplay
        data on our servers as needed to operate the Service. Content you submit, including chat
        and direct messages, is not private. Our{" "}
        <strong class="text-base-content">Privacy Policy</strong> explains what we collect and how
        we use it; by using the Service you agree to it.
      </p>
    ),
  },
  {
    heading: "8. Suspension and termination",
    body: (
      <p>
        <strong class="text-base-content">
          We may suspend, restrict, or terminate your access to the Service, or any account, at any
          time and for any reason (or no reason), with or without notice.
        </strong>{" "}
        You may stop using the Service at any time. Sections of these Terms that by their nature
        should survive termination — including the license you grant in User Content, data
        retention, and the disclaimers and limitations below — will survive.
      </p>
    ),
  },
  {
    heading: "9. Service provided “as is”",
    body: (
      <p>
        The Service is provided on an "as is" and "as available" basis without warranties of any
        kind, whether express or implied, including any implied warranties of merchantability,
        fitness for a particular purpose, and non-infringement. We do not warrant that the Service
        will be uninterrupted, secure, error-free, or that any data or in-game progress will be
        preserved. Grindshell is in active development and its features may change or be removed.
      </p>
    ),
  },
  {
    heading: "10. Limitation of liability",
    body: (
      <p>
        To the maximum extent permitted by law, Grindshell, LLC and its owners, officers, and
        contributors will not be liable for any indirect, incidental, special, consequential, or
        punitive damages, or for any loss of data, progress, or virtual items, arising out of or
        relating to your use of (or inability to use) the Service. Virtual items and in-game
        currency have no monetary value and are not redeemable for cash.
      </p>
    ),
  },
  {
    heading: "11. Changes to these Terms",
    body: (
      <p>
        We may update these Terms from time to time. When we do, we will update the "last updated"
        date above. Your continued use of the Service after changes take effect constitutes your
        acceptance of the revised Terms.
      </p>
    ),
  },
  {
    heading: "12. Governing law",
    body: (
      <p>
        These Terms are governed by the laws of the State of Georgia, USA, without regard to its
        conflict-of-laws rules. Grindshell, LLC is formed in and operates out of Georgia, USA. You
        agree that the state and federal courts located in Georgia will have exclusive jurisdiction
        over any dispute arising out of or relating to these Terms or the Service.
      </p>
    ),
  },
  {
    heading: "13. Contact",
    body: (
      <p>
        Questions about these Terms can be directed to Grindshell, LLC at{" "}
        <a class="text-primary hover:underline" href="mailto:support@grindshell.com">
          support@grindshell.com
        </a>
        .
      </p>
    ),
  },
];

/** The Terms of Service document body — reused by the route and the modal. */
export function TosDocument() {
  return (
    <article class="prose-sm max-w-none text-sm leading-relaxed text-base-content/80 space-y-5">
      <p class="text-xs text-base-content/45">Last updated: {TOS_LAST_UPDATED}</p>
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
export function Tos() {
  return (
    <section class="size-full max-w-3xl" data-screen-label="Terms of Service">
      <header class="flex items-baseline gap-3 mb-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Terms of Service</h1>
        <span class="text-xs text-base-content/45">// the agreement you accepted</span>
      </header>
      <TosDocument />
    </section>
  );
}

/** Overlay viewer for the login gate (outside the router). */
export function TosModal(props: { onClose: () => void }) {
  return (
    <DocModal title="Terms of Service" onClose={props.onClose}>
      <TosDocument />
    </DocModal>
  );
}
