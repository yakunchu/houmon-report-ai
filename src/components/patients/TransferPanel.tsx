"use client";

/**
 * 患者リストの書き出し・読み込み（iPhone と PC で同じリストを使うため）。
 * - ファイルには実名・生年月日・住所が入る。サーバーには送らず、端末どうし（AirDrop・USB など）で直接渡す。
 * - 読み込みは、適用する前に内訳（追加・更新・グループ追加）を見せて確認する。
 */
import { useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import {
  exportFileName,
  exportStore,
  mergeStores,
  parseExport,
  type ExportFile,
  type ImportMode,
  type ImportSummary,
  type PatientId,
  type PatientStore,
} from "@/lib/patients";
import { Button, ChoiceButtons, inputClass } from "../ui";

type Props = {
  store: PatientStore;
  /** 読み込み結果を適用する（作業中の患者の作業用コピーの整合は呼び出し側で取る） */
  onImport: (next: PatientStore) => void;
  onClose: () => void;
  /** 患者リストに登録済みで、いま作業中の患者（未登録なら null） */
  selectedId: PatientId | null;
};

/** 読み込めるファイルの上限（バイト） */
const MAX_BYTES = 10 * 1024 * 1024;

const MODE_LABEL: Record<ImportMode, string> = {
  merge: "追加・更新（おすすめ）",
  replace: "置き換え",
};
const MODE_OPTIONS = [MODE_LABEL.merge, MODE_LABEL.replace] as const;

const EXPORT_CONFIRM =
  "ファイルには患者さんの実名・生年月日・住所が入ります。自分の端末どうし（AirDrop・USB など）で直接移し、移し終えたらファイルを削除してください。メールやチャットでは送らないでください。書き出しますか？";

type Loaded = { ok: true; file: ExportFile; warnings: string[] } | { ok: false; message: string };

type Preview = { ok: true; store: PatientStore; summary: ImportSummary } | { ok: false };

/** 共有シート（AirDrop など）でファイルを渡せる環境か。HTTPS 以外などでは false */
function detectShare(): boolean {
  try {
    if (typeof navigator === "undefined") return false;
    if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
    return navigator.canShare({ files: [new File(["{}"], "check.json", { type: "application/json" })] });
  } catch {
    return false;
  }
}
const subscribeNone = () => () => {};

function formatExportedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", { dateStyle: "long", timeStyle: "short" });
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

export function TransferPanel({ store, onImport, onClose, selectedId }: Props) {
  const canShare = useSyncExternalStore(subscribeNone, detectShare, () => false);

  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [shareHint, setShareHint] = useState(false);

  const [mode, setMode] = useState<ImportMode>("merge");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const readSeq = useRef(0);

  const patientCount = store.patients.length;
  const groupCount = store.groups.length;

  /* ---------------- 書き出し ---------------- */

  function download(json: string, name: string): void {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // すぐ解放すると保存が始まる前に無効になる端末があるため、少し待つ
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  function doExport(): void {
    if (!window.confirm(EXPORT_CONFIRM)) return;
    setDone(null);
    setShareHint(false);
    const exportedAt = new Date().toISOString();
    try {
      const name = exportFileName(exportedAt);
      download(exportStore(store, exportedAt), name);
      setExportMsg(`書き出しました（${name}）。別の端末へ移し終えたら、このファイルを削除してください。`);
    } catch {
      setExportMsg("書き出せませんでした。もう一度お試しください。");
    }
  }

  async function doShare(): Promise<void> {
    if (!window.confirm(EXPORT_CONFIRM)) return;
    setDone(null);
    setShareHint(false);
    const exportedAt = new Date().toISOString();
    try {
      const name = exportFileName(exportedAt);
      const file = new File([exportStore(store, exportedAt)], name, { type: "application/json" });
      await navigator.share({ files: [file], title: "患者リスト" });
      setExportMsg("共有しました。別の端末へ移し終えたら、保存したファイルを削除してください。");
    } catch (e) {
      // キャンセルは何も出さない。それ以外の失敗はダウンロードを案内する
      if (!isAbort(e)) setShareHint(true);
    }
  }

  /* ---------------- 読み込み ---------------- */

  function inspect(text: string, name: string): void {
    setDone(null);
    setSourceName(name);
    try {
      setLoaded(parseExport(text));
    } catch {
      setLoaded({ ok: false, message: "ファイルを読み取れませんでした。" });
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ""; // 同じファイルをもう一度選べるようにする
    if (!file) return;
    const seq = ++readSeq.current;
    setDone(null);
    if (file.size > MAX_BYTES) {
      setSourceName(file.name);
      setLoaded({ ok: false, message: "ファイルが大きすぎます（10MB まで）。患者リストのファイルではない可能性があります。" });
      return;
    }
    try {
      const text = await file.text();
      if (seq === readSeq.current) inspect(text, file.name);
    } catch {
      if (seq !== readSeq.current) return;
      setSourceName(file.name);
      setLoaded({ ok: false, message: "ファイルを読み取れませんでした。もう一度選んでください。" });
    }
  }

  function checkPasted(): void {
    readSeq.current++;
    if (pasteText.length > MAX_BYTES) {
      setDone(null);
      setSourceName("貼り付けた内容");
      setLoaded({ ok: false, message: "貼り付けた内容が大きすぎます（10MB まで）。" });
      return;
    }
    inspect(pasteText, "貼り付けた内容");
  }

  // 適用はまだしない。同じ関数で内訳だけ出し、確認後にこの結果を保存する
  const preview = useMemo<Preview | null>(() => {
    if (!loaded || !loaded.ok) return null;
    try {
      const r = mergeStores(store, loaded.file, mode);
      return { ok: true, store: r.store, summary: r.summary };
    } catch {
      return { ok: false };
    }
  }, [loaded, store, mode]);

  const warnings = useMemo(() => {
    if (!loaded || !loaded.ok || !preview || !preview.ok) return [];
    return [...new Set([...loaded.warnings, ...preview.summary.warnings])];
  }, [loaded, preview]);

  const nothingToDo =
    mode === "merge" &&
    preview !== null &&
    preview.ok &&
    preview.summary.added === 0 &&
    preview.summary.updated === 0 &&
    preview.summary.groupsAdded === 0;

  // 作業中の患者が読み込み後のリストに残らないとき（置き換え）の注意
  const selectedWillLeave =
    selectedId !== null && preview !== null && preview.ok && !preview.store.patients.some((p) => p.id === selectedId);

  // 患者が 0 人のファイル（全員読み飛ばされた等）で置き換えると、端末のリストが丸ごと消えるだけなので止める
  const emptyReplace = mode === "replace" && preview !== null && preview.ok && preview.store.patients.length === 0;

  function applyImport(): void {
    if (!preview || !preview.ok || !loaded || !loaded.ok || emptyReplace) return;
    if (mode === "replace") {
      const after = preview.store.patients.length;
      if (!window.confirm(`端末の${patientCount}人のリストを、ファイルの${after}人に置き換えます。元に戻せません。よろしいですか？`)) return;
    }
    const s = preview.summary;
    onImport(preview.store);
    setDone(
      mode === "replace"
        ? `読み込みました。患者リストを${preview.store.patients.length}人（グループ${preview.store.groups.length}）に置き換えました。移し終えたら、元のファイルを削除してください。`
        : `読み込みました（追加 ${s.added}人・更新 ${s.updated}人・グループ追加 ${s.groupsAdded}）。移し終えたら、元のファイルを削除してください。`,
    );
    setLoaded(null);
    setSourceName("");
    setPasteText("");
  }

  function changeMode(label: string): void {
    setMode(label === MODE_LABEL.replace ? "replace" : "merge");
    setDone(null);
  }

  return (
    <div className="mt-4 rounded-xl border-2 border-slate-400 bg-slate-50 p-3 sm:p-4" aria-label="患者リストの書き出し・読み込み">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xl font-bold">患者リストの書き出し・読み込み</h3>
        <Button onClick={onClose}>閉じる</Button>
      </div>

      <p className="rounded-lg border-2 border-amber-700 bg-amber-50 px-3 py-2 font-bold text-amber-950">
        <span aria-hidden="true">⚠ </span>
        ファイルには患者さんの実名・生年月日・住所が入ります。自分の端末どうし（AirDrop・USB など）で直接移し、移し終えたらファイルを削除してください。メールやチャットで送らないでください。
      </p>
      <p className="mt-2 text-slate-800">サーバーや AI には送りません。ファイルは暗号化されません。</p>

      {/* 書き出し */}
      <section className="mt-4 rounded-xl border-2 border-slate-300 bg-white p-3" aria-labelledby="transfer-export-h">
        <h4 id="transfer-export-h" className="mb-2 text-lg font-bold">
          1. この端末のリストを書き出す
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={doExport} disabled={patientCount === 0}>
            ファイルに書き出す（{patientCount}人・グループ{groupCount}）
          </Button>
          {canShare ? (
            <Button onClick={() => void doShare()} disabled={patientCount === 0}>
              共有（AirDrop など）
            </Button>
          ) : null}
        </div>
        {patientCount === 0 ? <p className="mt-2 text-slate-800">書き出せる患者がまだいません。</p> : null}
        <p className="mt-2 text-slate-800">
          iPhone では「ファイル」アプリ（このiPhone内のダウンロード）に保存されます。そこから AirDrop などで相手の端末へ渡してください。
        </p>
        {shareHint ? (
          <p role="status" className="mt-2 font-bold text-amber-950">
            <span aria-hidden="true">⚠ </span>
            共有できませんでした。「ファイルに書き出す」を使ってください。
          </p>
        ) : null}
        {exportMsg ? (
          <p role="status" className="mt-2 break-words font-bold text-slate-900">
            <span aria-hidden="true">✓ </span>
            {exportMsg}
          </p>
        ) : null}
      </section>

      {/* 読み込み */}
      <section className="mt-4 rounded-xl border-2 border-slate-300 bg-white p-3" aria-labelledby="transfer-import-h">
        <h4 id="transfer-import-h" className="mb-2 text-lg font-bold">
          2. 別の端末のリストを読み込む
        </h4>

        <p className="mb-1 font-bold">読み込み方</p>
        <ChoiceButtons name="transfer-mode" label="読み込み方" options={MODE_OPTIONS} value={MODE_LABEL[mode]} onChange={changeMode} />
        <p className="mt-2 text-slate-800">
          {mode === "merge"
            ? "氏名と生年月日が同じ人は同じ患者として、更新日時が新しい方を使います（生年月日が未入力どうしの同姓同名も同じ人として扱います）。ほかの人は追加します。この端末にだけいる人は消えません。"
            : "この端末のリストを、ファイルの内容に丸ごと置き換えます。この端末にだけいる人は消えます。"}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-blue-800 bg-blue-800 px-5 py-2 text-lg font-bold text-white hover:bg-blue-900 has-[:focus-visible]:outline-4 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-700">
            ファイルを選ぶ
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => void onFile(e)}
            />
          </label>
          <span className="text-slate-800">JSON ファイル（10MB まで）</span>
        </div>

        <details className="mt-3">
          <summary className="flex min-h-12 cursor-pointer items-center text-lg font-bold">
            ファイルの中身を貼り付ける
          </summary>
          <label className="mt-2 block">
            <span className="mb-1 block text-slate-800">ファイルを開いて、中身をそのまま貼り付けてください。</span>
            <textarea
              className={`${inputClass} min-h-32 font-mono text-base`}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              aria-label="ファイルの中身"
            />
          </label>
          <Button className="mt-2" onClick={checkPasted} disabled={pasteText.trim() === ""}>
            内容を確認する
          </Button>
        </details>

        {loaded && !loaded.ok ? (
          <div role="alert" className="mt-3 rounded-lg border-2 border-red-800 bg-red-50 px-3 py-2 text-red-950">
            <p className="font-bold">
              <span aria-hidden="true">✕ </span>
              読み込めません
            </p>
            <p className="mt-1 break-words">{loaded.message}</p>
          </div>
        ) : null}

        {loaded && loaded.ok && preview && !preview.ok ? (
          <div role="alert" className="mt-3 rounded-lg border-2 border-red-800 bg-red-50 px-3 py-2 text-red-950">
            <p className="font-bold">
              <span aria-hidden="true">✕ </span>
              読み込めません
            </p>
            <p className="mt-1">内容を取り込む準備に失敗しました。ファイルが壊れている可能性があります。</p>
          </div>
        ) : null}

        {loaded && loaded.ok && preview && preview.ok ? (
          <div role="status" className="mt-3 rounded-lg border-2 border-blue-800 bg-blue-50 px-3 py-3 text-slate-900">
            <p className="font-bold">読み込む前の確認</p>
            {sourceName ? <p className="mt-1 break-all text-base">元: {sourceName}</p> : null}
            <p className="mt-1 text-base">書き出した日時: {formatExportedAt(loaded.file.exportedAt)}</p>
            <p className="mt-1 text-base">
              ファイルの中身: {loaded.file.patients.length}人・グループ{loaded.file.groups.length}
            </p>
            {mode === "merge" ? (
              <p className="mt-2 text-xl font-bold">
                追加 {preview.summary.added}人・更新 {preview.summary.updated}人・変更なし {preview.summary.unchanged}人・グループ追加{" "}
                {preview.summary.groupsAdded}
              </p>
            ) : (
              <p className="mt-2 text-xl font-bold">
                この端末の{patientCount}人（グループ{groupCount}）を、{preview.store.patients.length}人（グループ
                {preview.store.groups.length}）に置き換えます
              </p>
            )}
            {nothingToDo ? <p className="mt-1">この端末にすでに入っている内容と同じです。読み込む必要はありません。</p> : null}
            {emptyReplace ? (
              <p className="mt-1 font-bold text-red-950">
                <span aria-hidden="true">✕ </span>
                患者が 0 人のファイルでは置き換えできません（端末のリストが消えるだけになります）。すべて消したいときは「患者リストも含めて、この端末の保存をすべて消す」を使ってください。
              </p>
            ) : null}
            {selectedWillLeave ? (
              <p className="mt-2 font-bold text-amber-950">
                <span aria-hidden="true">⚠ </span>
                いま選んでいる患者は読み込み後のリストにいません。作業中の入力は消えませんが、「患者リストにまだ登録されていません」の扱いになります。
              </p>
            ) : null}
            {warnings.length > 0 ? (
              <div className="mt-2 font-bold text-amber-950">
                <p>
                  <span aria-hidden="true">⚠ </span>注意
                </p>
                <ul className="list-disc pl-6">
                  {warnings.map((w) => (
                    <li key={w} className="break-words">
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant={mode === "replace" ? "danger" : "primary"} onClick={applyImport} disabled={nothingToDo || emptyReplace}>
                この内容で読み込む
              </Button>
              <Button
                onClick={() => {
                  setLoaded(null);
                  setSourceName("");
                }}
              >
                やめる
              </Button>
            </div>
          </div>
        ) : null}

        {done ? (
          <p role="status" className="mt-3 rounded-lg border-2 border-green-800 bg-green-50 px-3 py-2 font-bold text-green-950">
            <span aria-hidden="true">✓ </span>
            {done}
          </p>
        ) : null}
      </section>
    </div>
  );
}
