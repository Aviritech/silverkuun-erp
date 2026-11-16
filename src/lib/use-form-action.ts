"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";

type Result = { error?: string; fieldErrors?: Record<string, string> };

/**
 * useActionState for forms, without React's automatic reset. React clears a form after every `action={...}` submit,
 * so a typo wiped everything the user had typed. Here the form is submitted through `onSubmit` instead: when the save
 * fails, every value stays and the first field with a problem gets focus (its Field shows the message in red); when it
 * succeeds, the form is reset as before.
 *
 * Use it as `const [state, onSubmit, pending] = useFormAction(action, {})` and `<form onSubmit={onSubmit}>`.
 */
export function useFormAction<S extends Result>(
  action: (prev: Awaited<S>, formData: FormData) => S | Promise<S>,
  initialState: Awaited<S>,
) {
  const [state, dispatch, pending] = useActionState(action, initialState);
  const lastForm = useRef<HTMLFormElement | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const form = e.currentTarget;
    lastForm.current = form;
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const formData = submitter ? new FormData(form, submitter) : new FormData(form);
    startTransition(() => dispatch(formData));
  }

  useEffect(() => {
    const form = lastForm.current;
    if (!form || state === initialState) return;
    const failing = Object.keys(state.fieldErrors ?? {});
    if (!state.error && failing.length === 0) {
      form.reset();
      return;
    }
    // Bring the first problem into view: the first named field with an error, or the error banner.
    for (const name of failing) {
      const field = form.elements.namedItem(name);
      const el = field instanceof RadioNodeList ? field[0] : field;
      if (el instanceof HTMLElement && !(el instanceof HTMLInputElement && el.type === "hidden")) {
        el.focus();
        return;
      }
    }
    form.querySelector<HTMLElement>("[role=alert], [data-field-error]")?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return [state, onSubmit, pending] as const;
}
