"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button, FormError } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const WIDTH = 480;
const HEIGHT = 160;

/** The Branch Manager signs in the box with a mouse, finger or stylus; the drawing is saved with the approval. */
export function ApprovalForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signature, setSignature] = useState("");

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#18181b";
  }, []);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) * WIDTH) / rect.width, y: ((e.clientY - rect.top) * HEIGHT) / rect.height };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    setSignature(e.currentTarget.toDataURL("image/png"));
  }

  function clear() {
    const ctx = canvas.current?.getContext("2d");
    ctx?.clearRect(0, 0, WIDTH, HEIGHT);
    setSignature("");
  }

  return (
    <form
      action={formAction}
      className="space-y-2"
      onSubmit={(e) => {
        if (!window.confirm("Approve this member? A membership number will be issued and your signature recorded.")) e.preventDefault();
      }}
    >
      <p className="text-xs text-zinc-500">Sign in the box to approve</p>
      <canvas
        ref={canvas}
        width={WIDTH}
        height={HEIGHT}
        aria-label="Signature box"
        className="block w-full max-w-[480px] touch-none rounded-lg border border-dashed border-zinc-400 bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <input type="hidden" name="signature" value={signature} />
      <FormError message={state.error ?? state.fieldErrors?.signature} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !signature}>
          {pending ? "Approving…" : "Approve and sign"}
        </Button>
        <Button type="button" variant="secondary" onClick={clear} disabled={pending}>
          Clear
        </Button>
      </div>
    </form>
  );
}
