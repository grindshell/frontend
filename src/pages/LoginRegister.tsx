import { Match, Show, Switch, createMemo, createSignal, type JSX } from "solid-js";
import { CFTurnstile } from "../components/CFTurnstile";
import { TextInput } from "../components/TextInput";
import { GdprConsent } from "../components/GdprConsent";
import * as api from "../lib/api";
import { enterOffline, setToken } from "../lib/auth";
import { config } from "../lib/config";

type Page = "login" | "register" | "forgot";

const captchaRequired = () => !!config.cfSitekey;

export function LoginRegister() {
  const [page, setPage] = createSignal<Page>("login");
  const year = new Date().getFullYear();

  return (
    <div class="min-h-screen bg-base-100 text-base-content flex flex-col items-center justify-between p-4">
      <div class="flex-1 flex items-center w-full">
        <div class="card mx-auto w-full max-w-4xl shadow-xl overflow-hidden">
          <div class="grid grid-cols-1 md:grid-cols-2 bg-base-200 rounded-xl">
            <Descriptor />
            <div class="p-8 md:p-10 flex flex-col justify-center">
              <Switch>
                <Match when={page() === "login"}>
                  <Login setPage={setPage} />
                </Match>
                <Match when={page() === "register"}>
                  <Register setPage={setPage} />
                </Match>
                <Match when={page() === "forgot"}>
                  <Forgot setPage={setPage} />
                </Match>
              </Switch>

              <Show when={config.uiDev}>
                <div class="divider text-xs text-base-content/40 my-4">dev</div>
                <button class="btn btn-sm btn-ghost" onClick={() => enterOffline()}>
                  Continue offline (no server)
                </button>
              </Show>
            </div>
          </div>
        </div>
      </div>
      <GdprConsent />
      <footer class="footer footer-center text-xs text-base-content/40 pt-4">
        Copyright Grindshell {year}
      </footer>
    </div>
  );
}

function Descriptor() {
  return (
    <div class="hero min-h-full rounded-l-xl bg-base-300">
      <div class="hero-content py-12 text-center">
        <div class="max-w-md">
          <h1 class="text-3xl font-bold font-mono tracking-tight">Grindshell</h1>
          <p class="mt-8 text-base-content/70 leading-relaxed">
            A world fractured and society lost under the ruins of before. Lead your group of
            explorers to find what's left.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------------- shared form scaffold ---------------- */

function FormShell(props: {
  title: string;
  children: JSX.Element;
  onSubmit: () => void;
  submitText: string;
  canSubmit: boolean;
  busy: boolean;
  error?: string;
  onCaptcha: (token: string) => void;
  onCaptchaExpired?: () => void;
  footer?: JSX.Element;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (props.canSubmit && !props.busy) props.onSubmit();
      }}
    >
      <h2 class="text-2xl font-semibold text-center mb-4">{props.title}</h2>
      {props.children}

      <Show when={captchaRequired()} fallback={<p class="text-[11px] text-base-content/35 text-center mt-2">CAPTCHA disabled (no sitekey configured).</p>}>
        <CFTurnstile onSuccess={props.onCaptcha} onExpired={props.onCaptchaExpired} />
      </Show>

      <Show when={props.error}>
        <div role="alert" class="alert alert-error text-sm mt-2 py-2">
          {props.error}
        </div>
      </Show>

      <button type="submit" class="btn btn-primary w-full mt-3" disabled={!props.canSubmit || props.busy}>
        <Show when={props.busy} fallback={props.submitText}>
          <span class="loading loading-spinner loading-sm" />
        </Show>
      </button>

      {props.footer}
    </form>
  );
}

function SwitchLink(props: { text: string; onClick: () => void }) {
  return (
    <>
      <div class="divider my-4" />
      <p class="text-center text-sm">
        <span class="text-primary hover:underline cursor-pointer" onClick={() => props.onClick()}>
          {props.text}
        </span>
      </p>
    </>
  );
}

/* ---------------- login ---------------- */

function Login(props: { setPage: (p: Page) => void }) {
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [cfToken, setCfToken] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();

  const usernameError = createMemo(() => validateUsername(username()));
  const captchaOk = () => !captchaRequired() || cfToken().length > 0;
  const canSubmit = () =>
    usernameError() === undefined && username().length > 0 && password().length >= 10 && captchaOk();

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const token = await api.login(cfToken(), username(), password());
      setToken(token);
    } catch (e) {
      setError((e as api.AuthError).message ?? "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormShell
      title="Login"
      onSubmit={submit}
      submitText="Login"
      canSubmit={canSubmit()}
      busy={busy()}
      error={error()}
      onCaptcha={setCfToken}
      onCaptchaExpired={() => setCfToken("")}
      footer={
        <SwitchLink text="No account? Register or create a guest account!" onClick={() => props.setPage("register")} />
      }
    >
      <TextInput legend="Username" placeholder="Username" value={username()} errText={usernameError()} onInput={setUsername} />
      <TextInput type="password" legend="Password" placeholder="Password" value={password()} onInput={setPassword} />
      <div class="text-right text-sm text-primary hover:underline cursor-pointer" onClick={() => props.setPage("forgot")}>
        Forgot password?
      </div>
    </FormShell>
  );
}

/* ---------------- register ---------------- */

function Register(props: { setPage: (p: Page) => void }) {
  const [email, setEmail] = createSignal("");
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [cfToken, setCfToken] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();

  // All-empty credentials → guest registration.
  const isGuest = () => email().length === 0 && username().length === 0 && password().length === 0;
  const emailError = createMemo(() => validateEmail(email()));
  const usernameError = createMemo(() => validateUsername(username()));
  const passwordError = createMemo(() => validatePassword(password()));
  const captchaOk = () => !captchaRequired() || cfToken().length > 0;

  const canSubmit = () =>
    captchaOk() &&
    (isGuest() ||
      (emailError() === undefined &&
        usernameError() === undefined &&
        passwordError() === undefined &&
        username().length > 0 &&
        password().length >= 10));

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const token = isGuest()
        ? await api.register(cfToken())
        : await api.register(cfToken(), {
            username: username(),
            password: password(),
            email: email() || undefined,
          });
      setToken(token);
    } catch (e) {
      setError((e as api.AuthError).message ?? "Registration failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormShell
      title="Register"
      onSubmit={submit}
      submitText={isGuest() ? "Create Guest Account" : "Register"}
      canSubmit={canSubmit()}
      busy={busy()}
      error={error()}
      onCaptcha={setCfToken}
      onCaptchaExpired={() => setCfToken("")}
      footer={<SwitchLink text="Already have an account? Login!" onClick={() => props.setPage("login")} />}
    >
      <TextInput legend="Email" placeholder="your@email.address" value={email()} errText={emailError()} onInput={setEmail} optional />
      <TextInput legend="Username" placeholder="Username" value={username()} errText={usernameError()} onInput={setUsername} optional={isGuest()} />
      <TextInput type="password" legend="Password" placeholder="Password" value={password()} errText={passwordError()} onInput={setPassword} optional={isGuest()} />
    </FormShell>
  );
}

/* ---------------- forgot password ---------------- */

function Forgot(props: { setPage: (p: Page) => void }) {
  // Password recovery is canon (accounts.md) but the backend has no endpoint
  // yet, so this is an informational stub rather than a dead form.
  return (
    <div>
      <h2 class="text-2xl font-semibold text-center mb-4">Forgot Password</h2>
      <p class="text-sm text-base-content/60 text-center">
        Password recovery isn't available yet. Verified-email accounts will be able to reset
        here once the server supports it.
      </p>
      <button class="btn btn-soft w-full mt-4" onClick={() => props.setPage("login")}>
        Back to login
      </button>
    </div>
  );
}

/* ---------------- validation (matches backend accounts.md rules) ---------------- */

function validateUsername(username: string): string | undefined {
  if (username.length === 0) return undefined;
  if (username.length < 3) return "Username must be at least 3 characters long.";
  if (username.length > 12) return "Username must be 12 characters or fewer.";
  if (!/^[a-zA-Z0-9]*$/.test(username)) return "Use only English alphanumeric characters.";
  return undefined;
}

function validateEmail(email: string): string | undefined {
  if (email.length === 0) return undefined;
  const parts = email.split("@");
  if (parts.length !== 2 || parts[0].length < 1) return "Invalid email.";
  const labels = parts[1].split(".");
  if (labels.length < 2 || labels.some((l) => l.length < 1)) return "Invalid email domain.";
  return undefined;
}

function validatePassword(password: string): string | undefined {
  if (password.length === 0) return undefined;
  if (password.length < 10) return "Password must be at least 10 characters long.";
  return undefined;
}
