"use client";
/**
 * 端末診断の画面（/diag）。iPhone の Safari で https で開き、録音と端末内音声認識が使えるかを確かめる。
 * - 患者データや会話は一切扱わない。録音した音声は端末のメモリにだけ置き、画面を閉じると消える。
 * - 音声認識のテストは、端末内処理（processLocally）を指定できる場合だけ動く。
 * - 結果は「結果をコピー」で文章にして、チャットに貼り付けて報告できる。
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, Section } from "@/components/ui";
import { copyText } from "@/lib/ui/clipboard";
import {
  collectDiag,
  detectSpeechSupport,
  errorText,
  formatDiagText,
  supportedRecorderTypes,
  type DiagSnapshot,
} from "@/lib/diag/device";

const RECORD_SECONDS = 3;
const SPEECH_SECONDS = 8;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function DeviceDiag() {
  const [diag, setDiag] = useState<DiagSnapshot | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"mic" | "record" | "speech" | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [speechLive, setSpeechLive] = useState("");
  const [copyNote, setCopyNote] = useState("");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void collectDiag().then((d) => {
      if (alive.current) setDiag(d);
    });
    return () => {
      alive.current = false;
    };
  }, []);

  // 録音した音声の URL は、置き換えたとき・画面を離れるときに解放する
  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  const setTest = (name: string, value: string) => setTests((t) => ({ ...t, [name]: value }));

  async function testMic() {
    setBusy("mic");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      const rate = track?.getSettings().sampleRate;
      setTest("マイク許可", `OK（${track?.label || "マイク名なし"}${rate ? `、${rate} Hz` : ""}）`);
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      setTest("マイク許可", `失敗: ${errorText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function testRecord() {
    setBusy("record");
    let stream: MediaStream | null = null;
    const name = `${RECORD_SECONDS} 秒録音`;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = supportedRecorderTypes()[0];
      const rec = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      const stopped = new Promise<void>((resolve, reject) => {
        rec.onstop = () => resolve();
        rec.onerror = () => reject(new Error("録音中にエラーが起きました"));
      });
      rec.start();
      await sleep(RECORD_SECONDS * 1000);
      rec.stop();
      await stopped;
      const blob = new Blob(chunks, { type: rec.mimeType || type || "" });
      setAudioUrl(URL.createObjectURL(blob));
      setTest(name, `OK（${blob.type || "形式不明"}、${Math.max(1, Math.round(blob.size / 1024))} KB）→ 下の再生で聞こえるか確認`);
    } catch (e) {
      setTest(name, `失敗: ${errorText(e)}`);
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      setBusy(null);
    }
  }

  async function testSpeech() {
    const name = "端末内の音声認識";
    const speech = detectSpeechSupport();
    if (!speech.ctor || !speech.hasProcessLocally) {
      setTest(name, "この端末では行いません（端末内処理を指定できないため）");
      return;
    }
    setBusy("speech");
    setSpeechLive("");
    const rec = new speech.ctor();
    rec.lang = "ja-JP";
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    rec.processLocally = true;
    let finalText = "";
    let error = "";
    const ended = new Promise<void>((resolve) => {
      rec.onend = () => resolve();
    });
    rec.onresult = (ev) => {
      let interim = "";
      finalText = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = r[0]?.transcript ?? "";
        if (r.isFinal) finalText += t;
        else interim += t;
      }
      setSpeechLive(finalText + (interim ? `（途中: ${interim}）` : ""));
    };
    rec.onerror = (ev) => {
      error = `${ev.error}${ev.message ? `: ${ev.message}` : ""}`;
    };
    try {
      rec.start();
      await Promise.race([ended, sleep(SPEECH_SECONDS * 1000)]);
      rec.stop();
      await Promise.race([ended, sleep(3000)]);
      setTest(
        name,
        error
          ? `失敗: ${error}`
          : finalText
            ? `OK（認識結果: ${finalText}）`
            : "結果なし（声が入らなかったか、認識されませんでした）",
      );
    } catch (e) {
      setTest(name, `失敗: ${errorText(e)}`);
    } finally {
      try {
        rec.abort();
      } catch {
        // 既に止まっている
      }
      setBusy(null);
    }
  }

  const summary = formatDiagText(diag?.rows ?? [], tests, diag?.at ?? null);

  async function copyAll() {
    const how = await copyText(summary);
    setCopyNote(
      how === "failed" ? "コピーできませんでした。下の文章を長押しして選択してください。" : "コピーしました。チャットに貼り付けてください。",
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-3xl font-bold text-slate-900">端末診断</h1>
      <p className="text-slate-800">
        この iPhone / PC で、録音と端末内の音声認識が使えるかを確かめる画面です。患者さんの情報や会話は入力しないでください。録音した音声は端末の中にだけ置き、画面を閉じると消えます。
      </p>

      <Section id="diag-static" title="この端末でできること">
        {diag === null ? (
          <p className="text-slate-700">調べています…</p>
        ) : (
          <dl className="divide-y-2 divide-slate-200">
            {diag.rows.map((r) => (
              <div key={r.label} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <dt className="font-bold text-slate-900">
                  <span aria-hidden="true">{r.ok === null ? "・" : r.ok ? "○" : "×"} </span>
                  <span className="sr-only">{r.ok === null ? "" : r.ok ? "使える: " : "使えない: "}</span>
                  {r.label}
                </dt>
                <dd className="text-slate-800">{r.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section id="diag-tests" title="ボタンで試す（マイクの許可を求めます）">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={testMic} disabled={busy !== null}>
            {busy === "mic" ? "確認中…" : "① マイクを試す"}
          </Button>
          <Button variant="primary" onClick={testRecord} disabled={busy !== null}>
            {busy === "record" ? `録音中（${RECORD_SECONDS} 秒）…` : `② ${RECORD_SECONDS} 秒だけ録音して再生`}
          </Button>
          <Button variant="primary" onClick={testSpeech} disabled={busy !== null || !(diag?.canTestSpeech ?? false)}>
            {busy === "speech" ? "聞き取り中…（話してください）" : "③ 端末内の音声認識を試す"}
          </Button>
        </div>
        {diag && diag.speechNote ? <p className="mt-3 text-slate-800">③ は使えません: {diag.speechNote}</p> : null}
        {busy === "speech" ? (
          <p className="mt-3 text-slate-800">
            「きょうは いい てんき です」など、患者さんの情報を含まない言葉を {SPEECH_SECONDS} 秒以内に話してください。
          </p>
        ) : null}
        {speechLive ? <p className="mt-2 rounded-lg bg-slate-100 p-3 text-slate-900">聞き取り: {speechLive}</p> : null}
        {audioUrl ? (
          <div className="mt-3">
            <p className="mb-1 font-bold text-slate-900">録音の再生（{RECORD_SECONDS} 秒）</p>
            <audio controls src={audioUrl} className="w-full" />
          </div>
        ) : null}
        {Object.keys(tests).length > 0 ? (
          <ul className="mt-4 space-y-1 text-slate-900">
            {Object.entries(tests).map(([k, v]) => (
              <li key={k}>
                <span className="font-bold">{k}:</span> {v}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section id="diag-copy" title="結果を報告する">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={copyAll} disabled={diag === null}>
            結果をコピー
          </Button>
          {copyNote ? <span className="text-slate-800">{copyNote}</span> : null}
        </div>
        <textarea
          readOnly
          aria-label="診断結果の文章"
          value={summary}
          rows={10}
          className="mt-3 block w-full rounded-lg border-2 border-slate-400 bg-slate-50 p-3 text-base text-slate-900"
        />
      </Section>

      <p>
        <Link href="/" className="font-bold text-blue-900 underline">
          報告書の画面へ戻る
        </Link>
      </p>
    </main>
  );
}
