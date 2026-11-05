"use client";

/**
 * 患者リストの書き出し・読み込み（iPhone と PC で同じリストを使うため）。
 * - ファイルには実名・生年月日・住所が入る。ファイルの書き出し・読み込みはサーバーを介さず、端末どうし（AirDrop・USB など）で直接渡す。
 * - 受け渡しコードだけは例外で、患者リスト（実名・生年月日・住所を含む）を暗号化してサーバーのメモリに 10 分だけ預ける。
 *   復号に使うコードもサーバーに送るので、サーバーを動かしているパソコンでは中身を読める。AI には送らない。
 *   サーバーの設定（HOUMON_SYNC=on）を明示したときだけ使える（既定はオフ）。画面の文言はこの事実どおりに書くこと。
 * - 読み込みは、適用する前に内訳（追加・更新・グループ追加）を見せて確認する。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type FormEvent } from "react";
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
import { exportForRelay } from "@/lib/patients/transfer";
import { describeRelayServer, receiveFromRelay, sendToRelay, type ServerPlace } from "@/lib/sync/client";
import { generateCode, isRelayCode } from "@/lib/sync/crypto";
import { Button, ChoiceButtons, WarnText, inputClass } from "../ui";

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

/** 預け先の言い方（画面を開いているホストから）。どのサーバーかが分かるようにする */
function placeText(place: ServerPlace): string {
  if (place.host === "") return "このアプリのサーバー";
  return place.kind === "lan"
    ? `このアプリを動かしているパソコン（${place.host}）`
    : `インターネット上のサーバー（${place.host}）`;
}

function relayConfirm(count: number, place: ServerPlace): string {
  return (
    `患者さんの実名・生年月日・住所を含む患者リスト（${count}人）を、この端末で暗号化して、${placeText(place)}に 10 分だけ預けます（受け取られると消えます）。` +
    "復号に使うコードもサーバーに送るため、そのサーバーを動かしているパソコンでは中身を読めます。AI には送りません。" +
    (place.kind === "public" && place.host !== "" ? "\n\n⚠ ここはインターネット上のサーバーに見えます。患者リストは預けないでください。" : "") +
    "\n\n同じ Wi-Fi の自分の端末で、表示されるコードを入力して受け取ってください。送りますか？"
  );
}

/** 全角数字などを半角にして、数字だけ 6 桁まで残す */
function normalizeCodeInput(s: string): string {
  return s.normalize("NFKC").replace(/\D/g, "").slice(0, 6);
}

function formatRemaining(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

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
  // この画面を開いているホスト = 受け渡しコードの預け先（/api/sync は同じホストのサーバー）
  const host = useSyncExternalStore(subscribeNone, () => window.location.host, () => "");
  const place = describeRelayServer(host);

  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [shareHint, setShareHint] = useState(false);

  const [mode, setMode] = useState<ImportMode>("merge");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const readSeq = useRef(0);

  // 受け渡しコード
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ code: string; expiresLocal: number } | null>(null);
  const [now, setNow] = useState(0);
  const [sendError, setSendError] = useState<string | null>(null);
  const [recvCode, setRecvCode] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [recvError, setRecvError] = useState<string | null>(null);
  const [recvOk, setRecvOk] = useState(false);
  const [viaCode, setViaCode] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const scrollOnLoad = useRef(false);

  const patientCount = store.patients.length;
  const groupCount = store.groups.length;
  const selectedPatient = selectedId !== null ? store.patients.find((p) => p.id === selectedId) : undefined;
  const effectiveScope = scope === "selected" && selectedPatient ? "selected" : "all";
  const SCOPE_ALL = `患者リスト全体（${patientCount}人）`;
  const SCOPE_ONE = selectedPatient
    ? `いま選んでいる患者だけ（${selectedPatient.familyName} ${selectedPatient.givenName}）`
    : "";
  const sendCount = effectiveScope === "selected" ? 1 : patientCount;
  const remainingSec = sent ? Math.max(0, Math.ceil((sent.expiresLocal - now) / 1000)) : 0;

  // 残り時間を 1 秒ごとに更新する
  useEffect(() => {
    if (!sent) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [sent]);

  // コードで受け取った内容は、下の確認画面までスクロールして見せる
  useEffect(() => {
    if (!loaded || !scrollOnLoad.current) return;
    scrollOnLoad.current = false;
    resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loaded]);

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

  function inspect(text: string, name: string, byCode = false): Loaded {
    setDone(null);
    setSourceName(name);
    setViaCode(byCode);
    let result: Loaded;
    try {
      result = parseExport(text);
    } catch {
      result = { ok: false, message: "ファイルを読み取れませんでした。" };
    }
    setLoaded(result);
    return result;
  }

  /* ---------------- 受け渡しコード ---------------- */

  async function doSend(): Promise<void> {
    if (sending || !window.confirm(relayConfirm(sendCount, place))) return;
    setSendError(null);
    setSent(null);
    setDone(null);
    const exportedAt = new Date().toISOString();
    const json =
      effectiveScope === "selected" && selectedPatient
        ? exportForRelay(store, exportedAt, selectedPatient.id)
        : exportForRelay(store, exportedAt);
    if (json === null) {
      setSendError("送る患者が見つかりません。選び直してください。");
      return;
    }
    setSending(true);
    try {
      let message = "送れませんでした。もう一度お試しください。";
      for (let attempt = 0; attempt < 3; attempt++) {
        const code = generateCode();
        const r = await sendToRelay(json, code);
        if (r.ok) {
          const t = Date.now();
          setNow(t);
          setSent({ code, expiresLocal: t + r.ttlSeconds * 1000 });
          return;
        }
        message = r.message;
        if (r.kind !== "exists") break; // 同じコードがあるときだけ、別のコードで送り直す
      }
      setSendError(message);
    } finally {
      setSending(false);
    }
  }

  async function doReceive(e?: FormEvent): Promise<void> {
    e?.preventDefault();
    if (receiving || !isRelayCode(recvCode)) return;
    const seq = ++readSeq.current;
    setReceiving(true);
    setRecvError(null);
    setRecvOk(false);
    setDone(null);
    try {
      const r = await receiveFromRelay(recvCode);
      if (seq !== readSeq.current) return;
      if (!r.ok) {
        setRecvError(r.message);
        return;
      }
      setRecvCode("");
      scrollOnLoad.current = true;
      const res = inspect(r.json, "受け渡しコード", true);
      if (res.ok) setRecvOk(true);
      else setRecvError(`受け取った内容は患者リストではありませんでした（${res.message}）。送る側でもう一度「送る」を押してください。`);
    } finally {
      setReceiving(false);
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
        ? `読み込みました。患者リストを${preview.store.patients.length}人（グループ${preview.store.groups.length}）に置き換えました。${viaCode ? "" : "移し終えたら、元のファイルを削除してください。"}`
        : `読み込みました（追加 ${s.added}人・更新 ${s.updated}人・グループ追加 ${s.groupsAdded}）。${viaCode ? "" : "移し終えたら、元のファイルを削除してください。"}`,
    );
    setLoaded(null);
    setSourceName("");
    setPasteText("");
    setRecvOk(false);
  }

  function changeMode(label: string): void {
    setMode(label === MODE_LABEL.replace ? "replace" : "merge");
    setDone(null);
  }

  return (
    <div className="mt-4 rounded-xl border-2 border-line bg-surface p-3 sm:p-4" aria-label="患者リストの書き出し・読み込み">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xl font-bold">患者リストの書き出し・読み込み</h3>
        <Button onClick={onClose}>閉じる</Button>
      </div>

      <p className="rounded-xl border-2 border-akane bg-raised px-3 py-2 font-bold text-ink">
        <span aria-hidden="true" className="text-akane">⚠ </span>
        ファイルには患者さんの実名・生年月日・住所が入ります。自分の端末どうし（AirDrop・USB など）で直接移し、移し終えたらファイルを削除してください。メールやチャットで送らないでください。
        受け渡しコードを使うときも、実名・生年月日・住所を含む患者リストが、サーバーを動かしているパソコンに 10 分だけ残ります。
      </p>
      <p className="mt-2 text-ink">
        ファイルの書き出し・読み込みは、サーバーにも AI にも送りません（ファイルは暗号化されません）。受け渡しコードだけは、患者リストを暗号化してサーバーに
        10 分だけ預けます。復号に使うコードもサーバーに送るので、サーバーを動かしているパソコンでは中身を読めます（AI には送りません）。
      </p>

      {/* 受け渡しコード */}
      <section className="mt-4 rounded-xl border-2 border-ai bg-raised p-3" aria-labelledby="transfer-relay-h">
        <h4 id="transfer-relay-h" className="mb-2 text-lg font-bold">
          1. 受け渡しコードで渡す（同じ Wi-Fi の薬局のパソコンのとき）
        </h4>
        <p className="text-ink">
          同じ Wi-Fi の薬局のパソコンと受け渡します。内容は端末の中で暗号化して、サーバーに 10 分だけ預けて消します。AI には送りません。
          サーバーの設定で受け渡しコードがオフのときは使えません（その場合は下の「ファイルに書き出す」で渡してください）。
        </p>

        <div className="mt-3 rounded-xl border-2 border-line p-3">
          <p className="mb-2 text-lg font-bold">送る側</p>
          <p className="mb-1 font-bold">送る内容</p>
          <ChoiceButtons
            name="relay-scope"
            label="送る内容"
            options={selectedPatient ? [SCOPE_ALL, SCOPE_ONE] : [SCOPE_ALL]}
            value={effectiveScope === "selected" ? SCOPE_ONE : SCOPE_ALL}
            onChange={(label) => {
              setScope(label === SCOPE_ONE ? "selected" : "all");
              setSent(null);
              setSendError(null);
            }}
          />
          {!selectedPatient ? (
            <p className="mt-2 text-ink">1 人だけ送るときは、先に患者リストでその人を選んでください。</p>
          ) : null}
          {effectiveScope === "selected" ? (
            <p className="mt-2 text-ink">
              1 人だけ送ったときは、受け取る側で「追加・更新」を選んでください（「置き換え」にすると、ほかの患者が消えます）。
            </p>
          ) : null}
          <div className="mt-3 rounded-xl border-2 border-akane bg-raised px-3 py-2 text-ink">
            <p className="font-bold">
              <span aria-hidden="true" className="text-akane">⚠ </span>
              何が送られるか
            </p>
            <p className="mt-1">
              実名・生年月日・住所を含む患者リスト（{sendCount} 人）を、暗号化して<strong>{placeText(place)}</strong>に 10 分だけ預けます。
              復号に使うコードもサーバーに送るため、そのサーバーを動かしているパソコンでは中身を読めます。AI には送りません。
            </p>
          </div>
          {place.kind === "public" && place.host !== "" ? (
            <WarnText>
              ここはインターネット上のサーバーに見えます。患者リストは預けないでください。受け渡しコードは、薬局のパソコンが動かす同じ Wi-Fi 内のサーバーだけで使います。
            </WarnText>
          ) : null}
          <div className="mt-3">
            <Button variant="primary" onClick={() => void doSend()} disabled={sending || patientCount === 0}>
              {sending ? "暗号化して預けています…" : "送る（暗号化して預ける）"}
            </Button>
          </div>
          {patientCount === 0 ? <p className="mt-2 text-ink">送れる患者がまだいません。</p> : null}
          {sendError ? <WarnText>{sendError}</WarnText> : null}

          {sent && remainingSec > 0 ? (
            <div role="status" className="mt-3 rounded-xl border-2 border-ai bg-shiroai px-3 py-3 text-ink">
              <p className="font-bold">
                <span aria-hidden="true" className="text-ai">✓ </span>
                預けました。受け取る端末でこのコードを入力してください。
              </p>
              <p
                className="my-2 break-all text-center font-mono text-5xl font-bold tracking-widest text-ink"
                aria-label={`コード ${sent.code.split("").join(" ")}`}
              >
                {sent.code.slice(0, 3)} {sent.code.slice(3)}
              </p>
              <p role="timer" className="text-center text-xl font-bold">
                残り {formatRemaining(remainingSec)}（10 分で消えます。受け取られても消えます）
              </p>
            </div>
          ) : null}
          {sent && remainingSec === 0 ? (
            <WarnText>期限が切れました。コードは使えません。もう一度「送る」を押してください。</WarnText>
          ) : null}
        </div>

        <form className="mt-3 rounded-xl border-2 border-line p-3" onSubmit={(e) => void doReceive(e)}>
          <p className="mb-2 text-lg font-bold">受け取る側</p>
          <label className="block">
            <span className="mb-1 block font-bold">コード（数字 6 桁）</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={12}
              autoComplete="off"
              className={`${inputClass} max-w-[14rem] font-mono text-3xl tracking-widest`}
              value={recvCode}
              onChange={(e) => {
                setRecvCode(normalizeCodeInput(e.target.value));
                setRecvError(null);
              }}
              placeholder="000000"
            />
          </label>
          <div className="mt-3">
            <Button type="submit" variant="primary" disabled={receiving || !isRelayCode(recvCode)}>
              {receiving ? "受け取っています…" : "受け取る（取得して復号）"}
            </Button>
          </div>
          {recvError ? <WarnText>{recvError}</WarnText> : null}
          {recvOk ? (
            <p role="status" className="mt-2 font-bold text-ink">
              <span aria-hidden="true" className="text-ai">✓ </span>
              受け取って復号しました。まだこの端末のリストは変わっていません。下の「3. 読み込む」の「読み込む前の確認」で内容を見てから読み込んでください。
            </p>
          ) : null}
        </form>
      </section>

      {/* 書き出し */}
      <section className="mt-4 rounded-xl border-2 border-line bg-raised p-3" aria-labelledby="transfer-export-h">
        <h4 id="transfer-export-h" className="mb-2 text-lg font-bold">
          2. ファイルに書き出す（この端末のリスト）
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
        {patientCount === 0 ? <p className="mt-2 text-ink">書き出せる患者がまだいません。</p> : null}
        <p className="mt-2 text-ink">
          iPhone では「ファイル」アプリ（このiPhone内のダウンロード）に保存されます。そこから AirDrop などで相手の端末へ渡してください。
        </p>
        {shareHint ? (
          <p role="status" className="mt-2 font-bold text-akane">
            <span aria-hidden="true" className="text-akane">⚠ </span>
            共有できませんでした。「ファイルに書き出す」を使ってください。
          </p>
        ) : null}
        {exportMsg ? (
          <p role="status" className="mt-2 break-words font-bold text-ink">
            <span aria-hidden="true" className="text-ai">✓ </span>
            {exportMsg}
          </p>
        ) : null}
      </section>

      {/* 読み込み */}
      <section className="mt-4 rounded-xl border-2 border-line bg-raised p-3" aria-labelledby="transfer-import-h">
        <h4 id="transfer-import-h" className="mb-2 text-lg font-bold">
          3. 読み込む（受け取った内容・ファイル）
        </h4>

        <p className="mb-1 font-bold">読み込み方</p>
        <ChoiceButtons name="transfer-mode" label="読み込み方" options={MODE_OPTIONS} value={MODE_LABEL[mode]} onChange={changeMode} />
        <p className="mt-2 text-ink">
          {mode === "merge"
            ? "氏名と生年月日が同じ人は同じ患者として、更新日時が新しい方を使います（生年月日が未入力どうしの同姓同名も同じ人として扱います）。ほかの人は追加します。この端末にだけいる人は消えません。"
            : "この端末のリストを、ファイルの内容に丸ごと置き換えます。この端末にだけいる人は消えます。"}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-ai bg-ai px-5 py-2 text-lg font-bold text-on-ai hover:bg-ai-hover has-[:focus-visible]:outline-4 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-hanada">
            ファイルを選ぶ
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => void onFile(e)}
            />
          </label>
          <span className="text-ink">JSON ファイル（10MB まで）</span>
        </div>

        <details className="mt-3">
          <summary className="flex min-h-12 cursor-pointer items-center text-lg font-bold">
            ファイルの中身を貼り付ける
          </summary>
          <label className="mt-2 block">
            <span className="mb-1 block text-ink">ファイルを開いて、中身をそのまま貼り付けてください。</span>
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

        <div ref={resultRef} className="scroll-mt-24">
        {loaded && !loaded.ok ? (
          <div role="alert" className="mt-3 rounded-xl border-2 border-akane bg-raised px-3 py-2 text-ink">
            <p className="font-bold text-akane">
              <span aria-hidden="true" className="text-akane">✕ </span>
              読み込めません
            </p>
            <p className="mt-1 break-words">{loaded.message}</p>
          </div>
        ) : null}

        {loaded && loaded.ok && preview && !preview.ok ? (
          <div role="alert" className="mt-3 rounded-xl border-2 border-akane bg-raised px-3 py-2 text-ink">
            <p className="font-bold text-akane">
              <span aria-hidden="true" className="text-akane">✕ </span>
              読み込めません
            </p>
            <p className="mt-1">内容を取り込む準備に失敗しました。ファイルが壊れている可能性があります。</p>
          </div>
        ) : null}

        {loaded && loaded.ok && preview && preview.ok ? (
          <div role="status" className="mt-3 rounded-xl border-2 border-ai bg-shiroai px-3 py-3 text-ink">
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
              <p className="mt-1 font-bold text-akane">
                <span aria-hidden="true" className="text-akane">✕ </span>
                患者が 0 人のファイルでは置き換えできません（端末のリストが消えるだけになります）。すべて消したいときは「患者リストも含めて、この端末の保存をすべて消す」を使ってください。
              </p>
            ) : null}
            {selectedWillLeave ? (
              <p className="mt-2 font-bold text-akane">
                <span aria-hidden="true" className="text-akane">⚠ </span>
                いま選んでいる患者は読み込み後のリストにいません。作業中の入力は消えませんが、「患者リストにまだ登録されていません」の扱いになります。
              </p>
            ) : null}
            {warnings.length > 0 ? (
              <div className="mt-2 font-bold text-akane">
                <p>
                  <span aria-hidden="true" className="text-akane">⚠ </span>注意
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

        </div>

        {done ? (
          <p role="status" className="mt-3 rounded-xl border-2 border-ai bg-shiroai px-3 py-2 font-bold text-ink">
            <span aria-hidden="true" className="text-ai">✓ </span>
            {done}
          </p>
        ) : null}
      </section>
    </div>
  );
}
