/**
 * ① 患者（折りたたみ可）。上に患者リスト（top）、下に今回の訪問の作業用コピー（基本情報）の入力欄。
 * 端末内にだけ保存する。
 */
import type { ReactNode } from "react";
import type { Group as PatientGroup, GroupId } from "@/lib/patients";
import { RECIPIENT_TYPES } from "@/lib/report/schema";
import { MEDICATION_MANAGER, MANAGEMENT_METHOD } from "@/lib/report/schema";
import { SAMPLES, type SampleId } from "@/lib/sample";
import { isBasicFilled } from "@/lib/ui/basic-info";
import type { AiField } from "@/lib/ui/suggestions";
import { DISPENSING_FORMS, SEX_OPTIONS, VISIT_FREQUENCIES, type BasicInfo } from "@/lib/ui/types";
import { AiBadge, Button, ChoiceButtons, Field, Section, inputClass } from "./ui";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="mt-6 min-w-0 rounded-xl border-2 border-slate-300 p-4">
      <legend className="px-2 text-xl font-bold">{title}</legend>
      <div className="space-y-4">{children}</div>
    </fieldset>
  );
}

/** ラベル + 「AI の提案（会話から）」バッジ（会話から自動入力した項目だけ） */
function LabelWithBadge({ text, ai }: { text: string; ai: boolean }) {
  return (
    <span className="mb-1 flex flex-wrap items-center gap-2 font-bold">
      {text}
      {ai ? <AiBadge /> : null}
    </span>
  );
}

export function BasicInfoSection({
  basic,
  onChange,
  open,
  onToggle,
  onLoadSample,
  onClearSaved,
  onClearEverything,
  top,
  groups,
  groupIds,
  onGroupIdsChange,
  aiFields,
}: {
  basic: BasicInfo;
  onChange: (next: BasicInfo) => void;
  open: boolean;
  onToggle: () => void;
  onLoadSample: (id: SampleId) => void;
  /** 作業中の入力（基本情報・会話・下書き）を消す。患者リストは残す */
  onClearSaved: () => void;
  /** 患者リストも含めて、この端末の保存をすべて消す */
  onClearEverything: () => void;
  /** 患者リスト（PatientPicker など）。見出しの下に置く */
  top: ReactNode;
  /** グループの一覧と、いまの患者が入っているグループ */
  groups: PatientGroup[];
  groupIds: GroupId[];
  onGroupIdsChange: (next: GroupId[]) => void;
  /** 会話から自動入力した項目（バッジを付ける） */
  aiFields: readonly AiField[];
}) {
  const set = (patch: Partial<BasicInfo>) => onChange({ ...basic, ...patch });
  const patientName = [basic.patientFamilyName, basic.patientGivenName].filter(Boolean).join(" ");
  const ai = (f: AiField) => aiFields.includes(f);

  return (
    <Section id="step-1" title="① 患者">
      {top}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={onToggle} aria-expanded={open} aria-controls="basic-body">
          {open ? "▲ 基本情報を閉じる" : "▼ 基本情報を開いて入力・修正する"}
        </Button>
        {SAMPLES.map((s) => (
          <Button key={s.id} onClick={() => onLoadSample(s.id)} title={s.description}>
            {s.label}を読み込む
          </Button>
        ))}
      </div>
      <p className="mt-2 text-base text-slate-800">
        架空サンプル①は登録済みの患者の流れ（ケアマネ宛）、②は新しい患者の流れ（医師宛。会話から基本情報が自動入力されます）。
      </p>
      {!open ? (
        <p className="mt-3 text-slate-800">
          {isBasicFilled(basic)
            ? `${patientName} さん ／ ${basic.recipientType}宛 ／ ${basic.pharmacy || "薬局名なし"}`
            : "まだ入力されていません。患者を選ぶか、「＋ 新しい患者」を押してください。"}
        </p>
      ) : null}

      {open ? (
        <div id="basic-body">
          <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-slate-900">
            この画面の内容は、この端末のブラウザの中にだけ保存されます。氏名・住所・生年月日・宛名・薬局名は、AIには送りません
            （氏名などは記号に置き換えてから送ります）。患者リストの記録を直したときは、上の「患者リストに保存」を押してください。
          </p>

          <Group title="宛先">
            <ChoiceButtons
              name="recipientType"
              label="宛先の種別"
              options={RECIPIENT_TYPES}
              value={basic.recipientType}
              onChange={(v) => set({ recipientType: v as BasicInfo["recipientType"] })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="宛名（ケアマネ用）" hint="出力の文頭に入ります">
                <input
                  className={inputClass}
                  value={basic.addresseeCareManager}
                  onChange={(e) => set({ addresseeCareManager: e.target.value })}
                />
              </Field>
              <Field label="宛名（医師用）" hint="出力の文頭に入ります">
                <input
                  className={inputClass}
                  value={basic.addresseeDoctor}
                  onChange={(e) => set({ addresseeDoctor: e.target.value })}
                />
              </Field>
            </div>
          </Group>

          <Group title="患者（端末内のみ・AIには送りません）">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="姓">
                <input
                  className={inputClass}
                  value={basic.patientFamilyName}
                  onChange={(e) => set({ patientFamilyName: e.target.value })}
                  autoComplete="off"
                />
              </Field>
              <Field label="名">
                <input
                  className={inputClass}
                  value={basic.patientGivenName}
                  onChange={(e) => set({ patientGivenName: e.target.value })}
                  autoComplete="off"
                />
              </Field>
            </div>
            <Field label="カナ（姓 名）">
              <input
                className={inputClass}
                value={basic.patientKana}
                onChange={(e) => set({ patientKana: e.target.value })}
                autoComplete="off"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="生年月日">
                <input
                  type="date"
                  className={inputClass}
                  value={basic.birthDate}
                  onChange={(e) => set({ birthDate: e.target.value })}
                />
              </Field>
              <div>
                <span className="mb-1 block font-bold">性別</span>
                <ChoiceButtons
                  name="sex"
                  label="性別"
                  options={SEX_OPTIONS}
                  value={basic.sex}
                  onChange={(v) => set({ sex: v })}
                />
              </div>
            </div>
            <Field label="住所">
              <input
                className={inputClass}
                value={basic.address}
                onChange={(e) => set({ address: e.target.value })}
                autoComplete="off"
              />
            </Field>
            <Field label="電話番号（あれば）">
              <input
                type="tel"
                className={inputClass}
                value={basic.phone}
                onChange={(e) => set({ phone: e.target.value })}
                autoComplete="off"
              />
            </Field>
            <fieldset className="min-w-0">
              <legend className="mb-1 font-bold">グループ（患者リストの絞り込み・並びに使います）</legend>
              {groups.length === 0 ? (
                <p className="text-slate-800">グループがありません。患者リストの「グループを管理」で作れます。</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {groups.map((g) => {
                    const checked = groupIds.includes(g.id);
                    return (
                      <label
                        key={g.id}
                        className={`flex min-h-12 cursor-pointer select-none items-center gap-2 rounded-lg border-2 px-4 py-2 text-lg font-bold has-[:focus-visible]:outline-4 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-700 ${
                          checked
                            ? "border-blue-800 bg-blue-800 text-white"
                            : "border-slate-500 bg-white text-slate-900 hover:bg-slate-100"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="size-6 shrink-0 accent-blue-900"
                          checked={checked}
                          onChange={() =>
                            onGroupIdsChange(checked ? groupIds.filter((id) => id !== g.id) : [...groupIds, g.id])
                          }
                        />
                        {g.name}
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>
          </Group>

          <Group title="家族">
            <label className="block">
              <LabelWithBadge text="家族構成・関与（続柄のみ。AIに送ります）" ai={ai("family")} />
              <span className="mb-1 block text-slate-700">氏名は書かないでください（例: 長女（別居。週末に様子を見に来る））</span>
              <input className={inputClass} value={basic.family} onChange={(e) => set({ family: e.target.value })} />
            </label>
            <div>
              <p className="mb-1 font-bold">家族の氏名と続柄（マスク用・端末内のみ）</p>
              <div className="space-y-2">
                {basic.familyMembers.map((m, i) => (
                  <div key={i} className="flex flex-wrap gap-2">
                    <input
                      aria-label={`家族${i + 1}の氏名`}
                      placeholder="氏名"
                      className={`${inputClass} flex-1 basis-40`}
                      value={m.name}
                      onChange={(e) =>
                        set({
                          familyMembers: basic.familyMembers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                        })
                      }
                    />
                    <input
                      aria-label={`家族${i + 1}の続柄`}
                      placeholder="続柄（長女 など）"
                      className={`${inputClass} flex-1 basis-40`}
                      value={m.relation}
                      onChange={(e) =>
                        set({
                          familyMembers: basic.familyMembers.map((x, j) =>
                            j === i ? { ...x, relation: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Button
                      variant="danger"
                      aria-label={`家族${i + 1}を削除`}
                      onClick={() => set({ familyMembers: basic.familyMembers.filter((_, j) => j !== i) })}
                    >
                      削除
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                className="mt-2"
                onClick={() => set({ familyMembers: [...basic.familyMembers, { name: "", relation: "" }] })}
              >
                ＋ 家族を追加
              </Button>
            </div>
            <Field label="その他マスクしたい語（医療機関名・事業所名など）" hint="読点（、）か改行で区切ります">
              <textarea
                className={`${inputClass} min-h-24`}
                value={basic.otherMaskWords}
                onChange={(e) => set({ otherMaskWords: e.target.value })}
              />
            </Field>
          </Group>

          <Group title="訪問・調剤・服薬管理（記録上の内容）">
            <div>
              <LabelWithBadge text="訪問頻度" ai={ai("visitFrequency")} />
              <ChoiceButtons
                name="visitFrequency"
                label="訪問頻度"
                options={VISIT_FREQUENCIES}
                value={basic.visitFrequency}
                onChange={(v) => set({ visitFrequency: v })}
              />
              {basic.visitFrequency === "その他" ? (
                <div className="mt-2">
                  <label className="block">
                    <LabelWithBadge text="その他の内容（例: 28日毎）" ai={ai("visitFrequencyNote")} />
                    <input
                      className={inputClass}
                      value={basic.visitFrequencyNote}
                      onChange={(e) => set({ visitFrequencyNote: e.target.value })}
                    />
                  </label>
                </div>
              ) : null}
            </div>
            <div>
              <LabelWithBadge text="調剤形態" ai={ai("dispensingForm")} />
              <ChoiceButtons
                name="dispensingForm"
                label="調剤形態"
                options={DISPENSING_FORMS}
                value={basic.dispensingForm}
                onChange={(v) => set({ dispensingForm: v })}
              />
            </div>
            <div>
              <LabelWithBadge text="記録上の服薬管理者（空欄可）" ai={ai("currentMedicationManager")} />
              <ChoiceButtons
                name="currentMedicationManager"
                label="記録上の服薬管理者"
                options={MEDICATION_MANAGER}
                value={basic.currentMedicationManager}
                onChange={(v) => set({ currentMedicationManager: v })}
              />
            </div>
            <div>
              <LabelWithBadge text="記録上の管理方法（空欄可）" ai={ai("currentManagementMethod")} />
              <ChoiceButtons
                name="currentManagementMethod"
                label="記録上の管理方法"
                options={MANAGEMENT_METHOD}
                value={basic.currentManagementMethod}
                onChange={(v) => set({ currentManagementMethod: v })}
              />
            </div>
            <Button
              onClick={() =>
                set({ currentMedicationManager: "", currentManagementMethod: "" })
              }
            >
              記録上の服薬管理者・管理方法を未設定に戻す
            </Button>
          </Group>

          <Group title="処方内容">
            <Field label="処方日・処方医（出力の見出し。AIには送りません）">
              <input
                className={inputClass}
                value={basic.prescriptionHeader}
                onChange={(e) => set({ prescriptionHeader: e.target.value })}
              />
            </Field>
            <Field label="処方内容（1行に1剤: 薬剤・量・用法・日数。AIに送ります）" hint="処方医名・医療機関名は書かないでください">
              <textarea
                className={`${inputClass} min-h-48`}
                value={basic.prescription}
                onChange={(e) => set({ prescription: e.target.value })}
              />
            </Field>
            <Field label="併用薬">
              <input
                className={inputClass}
                value={basic.concomitant}
                onChange={(e) => set({ concomitant: e.target.value })}
              />
            </Field>
          </Group>

          <Group title="薬局・今回の訪問の日付（患者の記録には入りません）">
            <Field label="薬局名・薬剤師名" hint="この端末の設定です。患者を切り替えても保たれます">
              <input className={inputClass} value={basic.pharmacy} onChange={(e) => set({ pharmacy: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="報告日（訪問日）">
                <input
                  type="date"
                  className={inputClass}
                  value={basic.reportDate}
                  onChange={(e) => set({ reportDate: e.target.value })}
                />
              </Field>
              <Field label="次回訪問日">
                <input
                  type="date"
                  className={inputClass}
                  value={basic.nextVisitDate}
                  onChange={(e) => set({ nextVisitDate: e.target.value })}
                />
              </Field>
            </div>
          </Group>

          <Group title="定型欄（出力にそのまま入ります）">
            <Field label="指導相手">
              <input
                className={inputClass}
                value={basic.counselingTarget}
                onChange={(e) => set({ counselingTarget: e.target.value })}
              />
            </Field>
            <Field label="後発品希望">
              <input
                className={inputClass}
                value={basic.genericPreference}
                onChange={(e) => set({ genericPreference: e.target.value })}
              />
            </Field>
            <Field label="お薬手帳">
              <input
                className={inputClass}
                value={basic.medicineNotebook}
                onChange={(e) => set({ medicineNotebook: e.target.value })}
              />
            </Field>
          </Group>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="danger" onClick={onClearSaved}>
              作業中の入力（基本情報・会話・下書き）を消す
            </Button>
            <Button variant="danger" onClick={onClearEverything}>
              患者リストも含めて、この端末の保存をすべて消す
            </Button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
