/** ① 基本情報（折りたたみ可）。薬局側の既存データを入力する。端末内にだけ保存する */
import type { ReactNode } from "react";
import { RECIPIENT_TYPES } from "@/lib/report/schema";
import { MEDICATION_MANAGER, MANAGEMENT_METHOD } from "@/lib/report/schema";
import { isBasicFilled } from "@/lib/ui/basic-info";
import { DISPENSING_FORMS, SEX_OPTIONS, VISIT_FREQUENCIES, type BasicInfo } from "@/lib/ui/types";
import { Button, ChoiceButtons, Field, Section, inputClass } from "./ui";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="mt-6 min-w-0 rounded-xl border-2 border-slate-300 p-4">
      <legend className="px-2 text-xl font-bold">{title}</legend>
      <div className="space-y-4">{children}</div>
    </fieldset>
  );
}

export function BasicInfoSection({
  basic,
  onChange,
  open,
  onToggle,
  onLoadSample,
  onClearSaved,
}: {
  basic: BasicInfo;
  onChange: (next: BasicInfo) => void;
  open: boolean;
  onToggle: () => void;
  onLoadSample: () => void;
  onClearSaved: () => void;
}) {
  const set = (patch: Partial<BasicInfo>) => onChange({ ...basic, ...patch });
  const patientName = [basic.patientFamilyName, basic.patientGivenName].filter(Boolean).join(" ");

  return (
    <Section id="step-1" title="① 基本情報">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onToggle} aria-expanded={open} aria-controls="basic-body">
          {open ? "▲ 閉じる" : "▼ 開いて入力・修正する"}
        </Button>
        <Button variant="primary" onClick={onLoadSample}>
          架空サンプル（山本花子さん）を読み込む
        </Button>
      </div>
      {!open ? (
        <p className="mt-3 text-slate-800">
          {isBasicFilled(basic)
            ? `${patientName} さん ／ ${basic.recipientType}宛 ／ ${basic.pharmacy || "薬局名なし"}`
            : "まだ入力されていません。"}
        </p>
      ) : null}

      {open ? (
        <div id="basic-body">
          <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-slate-900">
            この画面の内容は、この端末のブラウザの中にだけ保存されます。氏名・住所・生年月日・宛名・薬局名は、AIには送りません
            （氏名などは記号に置き換えてから送ります）。
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
          </Group>

          <Group title="家族">
            <Field label="家族構成・関与（続柄のみ。AIに送ります）" hint="氏名は書かないでください（例: 長女（別居。週末に様子を見に来る））">
              <input className={inputClass} value={basic.family} onChange={(e) => set({ family: e.target.value })} />
            </Field>
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
              <span className="mb-1 block font-bold">訪問頻度</span>
              <ChoiceButtons
                name="visitFrequency"
                label="訪問頻度"
                options={VISIT_FREQUENCIES}
                value={basic.visitFrequency}
                onChange={(v) => set({ visitFrequency: v })}
              />
              {basic.visitFrequency === "その他" ? (
                <div className="mt-2">
                  <Field label="その他の内容（例: 28日毎）">
                    <input
                      className={inputClass}
                      value={basic.visitFrequencyNote}
                      onChange={(e) => set({ visitFrequencyNote: e.target.value })}
                    />
                  </Field>
                </div>
              ) : null}
            </div>
            <div>
              <span className="mb-1 block font-bold">調剤形態</span>
              <ChoiceButtons
                name="dispensingForm"
                label="調剤形態"
                options={DISPENSING_FORMS}
                value={basic.dispensingForm}
                onChange={(v) => set({ dispensingForm: v })}
              />
            </div>
            <div>
              <span className="mb-1 block font-bold">記録上の服薬管理者（空欄可）</span>
              <ChoiceButtons
                name="currentMedicationManager"
                label="記録上の服薬管理者"
                options={MEDICATION_MANAGER}
                value={basic.currentMedicationManager}
                onChange={(v) => set({ currentMedicationManager: v })}
              />
            </div>
            <div>
              <span className="mb-1 block font-bold">記録上の管理方法（空欄可）</span>
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

          <Group title="薬局・日付">
            <Field label="薬局名・薬剤師名">
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

          <div className="mt-6">
            <Button variant="danger" onClick={onClearSaved}>
              この端末に保存した入力をすべて消す
            </Button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
