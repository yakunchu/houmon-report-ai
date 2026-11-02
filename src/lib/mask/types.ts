/**
 * 端末内マスク処理の契約（型と関数シグネチャ）。
 * 実装は src/lib/mask/mask.ts。すべて純関数で、ブラウザでもサーバーでも動く（ネットワークは使わない）。
 *
 * 流れ: 会話テキスト + 辞書 → maskText → {masked, tokens}
 *       masked だけを API に送る → 返ってきた下書き内の記号を unmaskText で元に戻す
 */

export type PersonKind = "patient" | "family" | "other";

export type PersonalInfoDictionary = {
  /** 患者。姓・名・カナは分けて持つ（「山本さん」「花子さん」「ヤマモトさん」も置き換えるため） */
  patient: { familyName: string; givenName: string; kana?: string };
  /** 家族・関係者。name は実名、relation は続柄（長女 など）。置換後は【家族1】のような記号 */
  family?: { name: string; relation: string }[];
  /** 住所（文字列そのまま置換 + 都道府県〜番地のゆるい一致） */
  address?: string;
  /** 生年月日。YYYY-MM-DD。和暦・西暦の表記ゆれも検出対象 */
  birthDate?: string;
  /** 電話番号 */
  phone?: string;
  /** その他、置き換えたい語（医療機関名・事業所名など） */
  others?: string[];
};

export type MaskKind = PersonKind | "address" | "birthDate" | "phone" | "postalCode";

export type MaskToken = {
  /** 置換後の記号。例: 【患者A】【家族1】【住所】【生年月日】【電話】 */
  token: string;
  /** 元の文字列 */
  original: string;
  kind: MaskKind;
};

export type MaskWarning = {
  /** 置き換えられなかったが個人情報らしい箇所（辞書に無い「○○さん」「○○様」など） */
  text: string;
  /** 元テキスト内の位置 */
  index: number;
  reason: string;
};

export type MaskResult = {
  masked: string;
  tokens: MaskToken[];
  warnings: MaskWarning[];
};

/**
 * 辞書と正規表現で個人情報を記号に置き換える。
 * - 辞書の語は長いものから順に置換（「山本花子」→「山本」の順）
 * - 患者の姓・名・カナ・フルネームはすべて同じ記号【患者A】になる
 * - 生年月日・電話番号・郵便番号は辞書に無くても正規表現で検出して置換する
 * - 置き換えられなかった「○○さん／○○様／○○先生」の○○（漢字・カタカナ1〜4文字）は warnings に入れる
 */
export type MaskTextFn = (text: string, dictionary: PersonalInfoDictionary) => MaskResult;

/** 記号を元の文字列に戻す。tokens に無い記号はそのまま残す */
export type UnmaskTextFn = (text: string, tokens: MaskToken[]) => string;

/** マスク済みテキストに、辞書の元の文字列が残っていないかを最終確認する（残っていれば true） */
export type ContainsOriginalFn = (masked: string, tokens: MaskToken[]) => boolean;
