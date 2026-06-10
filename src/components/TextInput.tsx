import { Show } from "solid-js";

// A labelled text input with optional validation-error / "optional" hint.
// Ported from frontend-old; DaisyUI fieldset styling.
export function TextInput(props: {
  onInput: (value: string) => void;
  type?: string;
  legend?: string;
  placeholder?: string;
  optional?: boolean;
  errText?: string;
  value?: string;
}) {
  return (
    <fieldset class="fieldset w-full">
      <Show when={props.legend}>
        <legend class="fieldset-legend">{props.legend}</legend>
      </Show>
      <input
        type={props.type ?? "text"}
        class="input w-full"
        classList={{ "input-error": props.errText !== undefined }}
        placeholder={props.placeholder ?? ""}
        value={props.value ?? ""}
        onInput={(e) => props.onInput(e.currentTarget.value)}
      />
      <Show when={props.errText || props.optional}>
        <p class="label" classList={{ "text-error": props.errText !== undefined }}>
          {props.errText ?? "Optional"}
        </p>
      </Show>
    </fieldset>
  );
}
