"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@/components/ui";

const WIDTH = 480;
const HEIGHT = 160;
const INK = "#18181b";
const SCRIPT_FONT = '"Segoe Script", "Snell Roundhand", "Brush Script MT", "Lucida Handwriting", cursive';

/**
 * A signature box: draw with a mouse, finger or stylus, or type a name that is set in a script face.
 * Either way the result is a PNG, sent in the hidden `signature` field with `method` (drawn or typed) and `typed_text`.
 */
export function SignaturePad({ onChange, disabled }: { onChange?: (signed: boolean) => void; disabled?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [method, setMethod] = useState<"drawn" | "typed">("drawn");
  const [typed, setTyped] = useState("");
  const [signature, setSignature] = useState("");

  function context() {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return null;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    return ctx;
  }

  function update(value: string) {
    setSignature(value);
    onChange?.(value !== "");
  }

  function clear() {
    context()?.clearRect(0, 0, WIDTH, HEIGHT);
    update("");
  }

  // Typed: set the name in a script face, shrinking it until it fits the box.
  useEffect(() => {
    if (method !== "typed") return;
    const ctx = context();
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const text = typed.trim();
    if (text.length < 2) {
      update("");
      return;
    }
    let size = 56;
    do {
      ctx.font = `italic ${size}px ${SCRIPT_FONT}`;
      size -= 2;
    } while (ctx.measureText(text).width > WIDTH - 32 && size > 14);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, WIDTH / 2, HEIGHT / 2);
    update(canvas.current!.toDataURL("image/png"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw only when the text or mode changes
  }, [typed, method]);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) * WIDTH) / rect.width, y: ((e.clientY - rect.top) * HEIGHT) / rect.height };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (method !== "drawn" || disabled) return;
    const ctx = context();
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
    const ctx = context();
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    update(e.currentTarget.toDataURL("image/png"));
  }

  function switchTo(next: "drawn" | "typed") {
    if (next === method) return;
    setMethod(next);
    context()?.clearRect(0, 0, WIDTH, HEIGHT);
    update("");
  }

  const tab = (value: "drawn" | "typed", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={method === value}
      onClick={() => switchTo(value)}
      disabled={disabled}
      className={`rounded-md px-3 py-1 text-sm font-medium ${method === value ? "bg-ink text-white" : "text-zinc-700 hover:bg-zinc-100"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-2">
      <div role="tablist" aria-label="How to sign" className="inline-flex gap-1 rounded-lg border border-zinc-200 bg-white p-1">
        {tab("drawn", "Draw")}
        {tab("typed", "Type")}
      </div>
      {method === "typed" && (
        <Input
          name="typed_text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          maxLength={120}
          placeholder="Type the full name as the signature"
          aria-label="Typed signature"
          disabled={disabled}
        />
      )}
      <canvas
        ref={canvas}
        width={WIDTH}
        height={HEIGHT}
        aria-label={method === "drawn" ? "Signature box: sign here" : "Typed signature preview"}
        className={`block w-full max-w-[480px] touch-none rounded-lg border border-dashed border-zinc-400 bg-white ${method === "drawn" ? "cursor-crosshair" : ""}`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <p className="text-xs text-zinc-500">{method === "drawn" ? "Sign in the box with a finger, stylus or mouse." : "The typed name is used as the signature."}</p>
      <input type="hidden" name="signature" value={signature} />
      <input type="hidden" name="method" value={method} />
      {method === "drawn" && <input type="hidden" name="typed_text" value="" />}
      <Button type="button" variant="secondary" onClick={method === "drawn" ? clear : () => setTyped("")} disabled={disabled || !signature}>
        Clear
      </Button>
    </div>
  );
}
