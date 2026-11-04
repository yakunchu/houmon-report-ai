"use client";
/**
 * 「クリップボードから貼り付け」ボタン。
 * iPhone でボイスメモの文字起こしをコピーしたあと、入力欄を長押しせずに会話欄へ入れるためのもの。
 * 読めないとき（http で開いている・許可されなかった）は、長押しの「ペースト」を案内する。
 */
import { useState } from "react";
import { readClipboardText } from "@/lib/ui/clipboard";
import { Button } from "./ui";

export function PasteButton({ onPaste, disabled = false }: { onPaste: (text: string) => void; disabled?: boolean }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function handlePaste() {
    setBusy(true);
    try {
      const r = await readClipboardText();
      if (!r.ok) {
        setNote(
          r.reason === "unsupported"
            ? "この開き方では貼り付けボタンが使えません。入力欄を長押しして「ペースト」を選んでください。"
            : "貼り付けが許可されませんでした。入力欄を長押しして「ペースト」を選んでください。",
        );
      } else if (r.text.trim() === "") {
        setNote("コピーした文字がありません。先にボイスメモなどで文字をコピーしてください。");
      } else {
        onPaste(r.text);
        setNote(`貼り付けました（${r.text.trim().length} 文字）`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={handlePaste} disabled={disabled || busy}>
        {busy ? "貼り付け中…" : "クリップボードから貼り付け"}
      </Button>
      {note ? (
        <span role="status" className="text-lg text-slate-800">
          {note}
        </span>
      ) : null}
    </>
  );
}
