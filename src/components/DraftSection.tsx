/** ③ 下書きフォーム。報告書ソフトと同じ並びで、選択式の欄・残薬・SOAP を直せる */
import { useEffect, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import {
  CHOICE_FIELDS,
  EVIDENCE_LABELS,
  SOAP_LABELS,
  isUnsure,
  type ChoiceFieldDef,
  type EvidenceKey,
} from "@/lib/report/fields";
import { UNSURE, type ReportDraft } from "@/lib/report/schema";
import {
  CONTACT_NOTES_MAX,
  addContactNote,
  evidenceKeyForGroup,
  groupReportOrder,
  patchChoice,
  patchContactNote,
  patchLeftover,
  removeContactNote,
} from "@/lib/ui/draft-utils";
import { checkQuoteInText, findMissingQuotes, splitQuotes } from "@/lib/ui/quotes";
import { Button, ChoiceButtons, Section, UnsureBadge, WarnText, inputClass } from "./ui";

const GROUPS = groupReportOrder();

type Props = {
  draft: ReportDraft;
  onChange: (next: ReportDraft) => void;
  /** AI に送ったマスク済み会話（引用照合の基準） */
  transcript: string;
  onProceed: () => void;
  /** 下書きが今の会話・宛先・基本情報から作ったものではない */
  stale: boolean;
};

function FieldCard({ label, badge, children }: { label: string; badge?: boolean; children: ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-line bg-raised p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h4 className="text-xl font-bold">{label}</h4>
        {badge ? <UnsureBadge /> : null}
      </div>
      {children}
    </div>
  );
}

function NoteInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="mt-3 block">
      <span className="mb-1 block font-bold text-ink">備考</span>
      <input
        aria-label={`${label}の備考`}
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function ChoiceCard({ def, draft, onChange }: { def: ChoiceFieldDef; draft: ReportDraft; onChange: (d: ReportDraft) => void }) {
  const v = draft[def.key];
  return (
    <FieldCard label={def.label} badge={isUnsure(v.choice)}>
      <ChoiceButtons
        name={`draft-${def.key}`}
        label={def.label}
        options={def.options}
        value={v.choice}
        onChange={(choice) => onChange(patchChoice(draft, def.key, { choice }))}
        unsureLabel={UNSURE}
      />
      {def.key === "daytimeSleep" && draft.daytimeSleep.choice === "有" ? (
        <label className="mt-3 block">
          <span className="mb-1 block font-bold text-ink">昼寝の長さ（○時間○分）</span>
          <input
            aria-label="睡眠・日中の昼寝の長さ"
            className={inputClass}
            placeholder="例: 1時間0分"
            value={draft.daytimeSleep.duration}
            onChange={(e) => onChange(patchChoice(draft, "daytimeSleep", { duration: e.target.value }))}
          />
        </label>
      ) : null}
      <NoteInput label={def.label} value={v.note} onChange={(note) => onChange(patchChoice(draft, def.key, { note }))} />
    </FieldCard>
  );
}

function MealsPerDayCard({ draft, onChange }: { draft: ReportDraft; onChange: (d: ReportDraft) => void }) {
  const m = draft.mealsPerDay;
  const unsure = isUnsure(m.value) || m.value.trim() === "";
  return (
    <FieldCard label="食事・回数" badge={unsure}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="食事の回数（回/日）"
          inputMode="numeric"
          className={`${inputClass} w-32`}
          value={isUnsure(m.value) ? "" : m.value}
          placeholder="例: 3"
          onChange={(e) => onChange({ ...draft, mealsPerDay: { ...m, value: e.target.value } })}
        />
        <span className="text-lg font-bold">回/日</span>
        <Button
          aria-pressed={isUnsure(m.value)}
          onClick={() => onChange({ ...draft, mealsPerDay: { ...m, value: UNSURE } })}
        >
          {isUnsure(m.value) ? "✓ " : "⚠ "}要確認にする
        </Button>
      </div>
      <NoteInput
        label="食事・回数"
        value={m.note}
        onChange={(note) => onChange({ ...draft, mealsPerDay: { ...m, note } })}
      />
    </FieldCard>
  );
}

function LeftoverCard({ draft, onChange }: { draft: ReportDraft; onChange: (d: ReportDraft) => void }) {
  const rows = draft.leftoverMedications;
  return (
    <FieldCard label="残薬">
      {rows.length === 0 ? <p className="mb-2">会話に残薬の話はありませんでした。</p> : null}
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl border-2 border-line bg-surface p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-bold">{i + 1}件目</span>
              {isUnsure(r.amount) ? <UnsureBadge text="要確認（残数）" /> : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block font-bold text-ink">薬剤名</span>
                <input
                  className={inputClass}
                  value={r.drugName}
                  onChange={(e) => onChange(patchLeftover(draft, i, { drugName: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="mb-1 block font-bold text-ink">残数</span>
                <input
                  className={inputClass}
                  value={r.amount}
                  placeholder="例: 4日分"
                  onChange={(e) => onChange(patchLeftover(draft, i, { amount: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="mb-1 block font-bold text-ink">備考</span>
                <input
                  className={inputClass}
                  value={r.note}
                  onChange={(e) => onChange(patchLeftover(draft, i, { note: e.target.value }))}
                />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button onClick={() => onChange(patchLeftover(draft, i, { amount: UNSURE }))}>残数を要確認にする</Button>
              <Button
                variant="danger"
                aria-label={`残薬${i + 1}件目を削除`}
                onClick={() => onChange({ ...draft, leftoverMedications: rows.filter((_, j) => j !== i) })}
              >
                削除
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button
        className="mt-3"
        onClick={() =>
          onChange({ ...draft, leftoverMedications: [...rows, { drugName: "", amount: "", note: "" }] })
        }
      >
        ＋ 残薬を追加
      </Button>
    </FieldCard>
  );
}

function SoapCard({ draft, onChange, transcript }: { draft: ReportDraft; onChange: (d: ReportDraft) => void; transcript: string }) {
  const missingS = findMissingQuotes(draft.soap.s, transcript);
  return (
    <FieldCard label="指導内容（SOAP）">
      <div className="space-y-4">
        {(["s", "o", "a", "p"] as const).map((k) => (
          <label key={k} className="block">
            <span className="mb-1 block text-lg font-bold">{SOAP_LABELS[k]}</span>
            <textarea
              className={`${inputClass} min-h-36 leading-8`}
              value={draft.soap[k]}
              onChange={(e) => onChange({ ...draft, soap: { ...draft.soap, [k]: e.target.value } })}
            />
            {k === "s" && missingS.length > 0 ? (
              <WarnText>
                原文にない引用があります: {missingS.map((q) => `「${q}」`).join("")}
                。会話の言葉と違っていないか確認してください。
              </WarnText>
            ) : null}
          </label>
        ))}
      </div>
    </FieldCard>
  );
}

/** 連絡事項（宛先向け）。印刷・メール・チャットの要旨に使う。1 件 1 文、最大 3 件 */
function ContactNotesCard({ draft, onChange }: { draft: ReportDraft; onChange: (d: ReportDraft) => void }) {
  const rows = draft.contactNotes;
  const full = rows.length >= CONTACT_NOTES_MAX;
  return (
    <FieldCard label={`連絡事項（宛先向け・1〜${CONTACT_NOTES_MAX} 件。印刷・メール・チャットの要旨に使います）`}>
      {rows.length === 0 ? <p className="mb-2">連絡事項はありません。必要なら追加してください。</p> : null}
      <div className="space-y-3">
        {rows.map((n, i) => (
          // スマホ幅でも 1 件が全文読めるよう、削除は見出しの行に置き、本文は幅いっぱいの 2 行欄にする
          <div key={i}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor={`contact-note-${i + 1}`} className="font-bold text-ink">
                {i + 1}件目
              </label>
              <Button
                variant="danger"
                aria-label={`連絡事項${i + 1}件目を削除`}
                onClick={() => onChange(removeContactNote(draft, i))}
              >
                削除
              </Button>
            </div>
            <AutoGrowTextarea
              id={`contact-note-${i + 1}`}
              rows={2}
              className={`${inputClass} resize-none overflow-hidden`}
              aria-label={`連絡事項${i + 1}件目`}
              placeholder="例: 残薬4日分は次回処方で日数調整をご検討いただきたい"
              value={n}
              onChange={(e) => onChange(patchContactNote(draft, i, e.target.value))}
            />
          </div>
        ))}
      </div>
      <Button className="mt-3" disabled={full} onClick={() => onChange(addContactNote(draft))}>
        ＋ 連絡事項を追加
      </Button>
      {full ? <p className="mt-2">連絡事項は最大 {CONTACT_NOTES_MAX} 件までです。</p> : null}
    </FieldCard>
  );
}

/** 中身の行数に合わせて高さが伸びる入力欄（スマホ幅でも 1 文が全部読めるように） */
function AutoGrowTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight は枠線を含まないので、上下の枠線（2px × 2）を足す
    el.style.height = `${el.scrollHeight + 4}px`;
  }, [props.value]);
  return <textarea ref={ref} {...props} />;
}

/** 根拠（会話からの引用）。原文に無い引用には警告を付ける */
function EvidencePanel({ evidenceKey, draft, transcript }: { evidenceKey: EvidenceKey; draft: ReportDraft; transcript: string }) {
  const quotes = splitQuotes(draft.evidence[evidenceKey]);
  return (
    <div className="mt-3 rounded-xl border-2 border-line bg-surface p-3">
      <p className="mb-2 font-bold">根拠: {EVIDENCE_LABELS[evidenceKey]}</p>
      {quotes.length === 0 ? (
        <p>根拠になる発話はありません（会話に話が出ていません）。</p>
      ) : (
        <ul className="space-y-2">
          {quotes.map((q, i) => {
            const ok = checkQuoteInText(q, transcript);
            return (
              <li key={i} className="flex flex-wrap items-start gap-2">
                <span
                  className={
                    ok
                      ? "rounded-md bg-shiroai px-2 font-bold text-ink"
                      : "rounded-md border-2 border-akane bg-raised px-2 font-bold text-ink"
                  }
                >
                  {ok ? <span className="text-ai">✓</span> : <span className="text-akane">⚠</span>}{" "}
                  {ok ? "原文にあり" : "原文にない引用"}
                </span>
                <span>「{q}」</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function DraftSection({ draft, onChange, transcript, onProceed, stale }: Props) {
  const [openEvidence, setOpenEvidence] = useState<Record<string, boolean>>({});

  return (
    <Section id="step-3" title="③ 下書き">
      {stale ? (
        <WarnText>
          この下書きは、今の会話・宛先・基本情報から作ったものではありません（変更前の内容のままです）。②で「個人名を見えないようマスク処理する」→「下書きを作り直す」を押してください。それまで出力へは進めません。
        </WarnText>
      ) : null}
      <p className="mb-4 rounded-xl bg-shiroai px-3 py-2 text-ink">
        AIが会話から下書きしました。会話に根拠がない欄は「要確認」のままです。内容を確認して、必要なら直してください。最終判断は薬剤師が行います。
      </p>
      <div className="space-y-8">
        {GROUPS.map((g) => {
          const ek = evidenceKeyForGroup(g.group);
          const opened = openEvidence[g.group] === true;
          return (
            <div key={g.group}>
              <h3 className="mb-3 font-display text-2xl font-bold text-ai">{g.group}</h3>
              <div className="space-y-3">
                {g.items.map((item) => {
                  if (item.key === "leftoverMedications") return <LeftoverCard key={item.key} draft={draft} onChange={onChange} />;
                  if (item.key === "mealsPerDay") return <MealsPerDayCard key={item.key} draft={draft} onChange={onChange} />;
                  if (item.key === "soap") {
                    return (
                      <div key={item.key} className="space-y-3">
                        <SoapCard draft={draft} onChange={onChange} transcript={transcript} />
                        <ContactNotesCard draft={draft} onChange={onChange} />
                      </div>
                    );
                  }
                  const def = CHOICE_FIELDS.find((f) => f.key === item.key);
                  return def ? <ChoiceCard key={item.key} def={def} draft={draft} onChange={onChange} /> : null;
                })}
              </div>
              {ek ? (
                <div className="mt-3">
                  <Button
                    aria-expanded={opened}
                    onClick={() => setOpenEvidence((prev) => ({ ...prev, [g.group]: !opened }))}
                  >
                    {opened ? "▲ 根拠を閉じる" : "▼ 根拠を見る"}
                  </Button>
                  {opened ? <EvidencePanel evidenceKey={ek} draft={draft} transcript={transcript} /> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-8 border-t-2 border-line pt-4">
        <Button variant="primary" onClick={onProceed} disabled={stale}>
          確認して出力へ進む
        </Button>
      </div>
    </Section>
  );
}
