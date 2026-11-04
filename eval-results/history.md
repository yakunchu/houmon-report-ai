# 評価履歴

`npm run eval` の実行ごとに 1 行追記されます。

| 日時 | model | effort | 選択式一致率 | S引用 | 所要秒 | in/out tokens | メモ |
|---|---|---|---|---|---|---|---|
| 2026-11-02 16:15 | claude-opus-5-5 | max | — | — | — | — | 失敗: max_tokens  |
| 2026-11-02 16:17 | claude-opus-5-5 | medium | 11/13 (85%) | 4/4 | 19.4 | 927/2183 | 宛先=ケアマネ fixture=yamamoto-hanako Day0 初回（HOUMON_EFFORT 未設定=medium） |
| 2026-11-02 16:19 | claude-opus-5-5 | medium | 13/13 (100%) | 3/3 | 12.7 | 927/1341 | 宛先=ケアマネ fixture=yamamoto-hanako Day0 ルール改訂1（尿頻度・運動・S/O/備考の型） |
| 2026-11-02 16:37 | claude-opus-5-5 | medium | 13/13 (100%) | 3/3 | 17.0 | 927/1929 | 宛先=ケアマネ fixture=yamamoto-hanako ルール改訂2（内容理解OK/要確認の判定） |
| 2026-11-02 16:38 | claude-opus-5-5 | medium | 13/13 (100%) | 3/3 | 21.8 | 1041/2692 | 宛先=ケアマネ fixture=fixture-rikai 架空変種: 説明直後に聞き返し・取り違え（内容理解要確認を期待） |
| 2026-11-04 09:01 | claude-opus-5-5 | medium | 13/13 (100%) | 3/3 | 25.3 | 947/2608 | 宛先=ケアマネ fixture=yamamoto-hanako 患者リスト対応後 |
| 2026-11-04 09:01 | claude-opus-5-5 | medium | 13/13 (100%) | 3/3 | 22.0 | 1013/2674 | 宛先=ケアマネ fixture=yamamoto-hanako new-patient 新患モード: 提案欄の確認 |
| 2026-11-04 09:44 | claude-opus-5-5 | medium | 13/13 (100%) | 2/2 | 19.4 | 959/2206 | 宛先=ケアマネ fixture=yamamoto-hanako ルール改訂3（備考1事実・S2件・A2文・P簡潔） |
| 2026-11-04 09:44 | claude-opus-5-5 | medium | 13/13 (100%) | 2/2 | 19.7 | 1073/2428 | 宛先=ケアマネ fixture=yamamoto-hanako-kikikaeshi ルール改訂3 |
| 2026-11-04 09:45 | claude-sonnet-5-5 | medium | 13/13 (100%) | 2/2 | 7.3 | 959/1211 | 宛先=ケアマネ fixture=yamamoto-hanako モデル比較: Sonnet 5.5 medium |
| 2026-11-04 09:45 | claude-opus-5-5 | low | 13/13 (100%) | 2/2 | 9.6 | 959/1240 | 宛先=ケアマネ fixture=yamamoto-hanako モデル比較: Opus 5.5 low |
| 2026-11-04 09:46 | claude-opus-5-5 | low | 13/13 (100%) | 2/2 | 10.7 | 1073/1355 | 宛先=ケアマネ fixture=yamamoto-hanako-kikikaeshi モデル比較: Opus 5.5 low（聞き返し台本） |
| 2026-11-04 09:46 | claude-sonnet-5-5 | medium | 13/13 (100%) | 2/2 | 8.3 | 1073/1262 | 宛先=ケアマネ fixture=yamamoto-hanako-kikikaeshi モデル比較: Sonnet 5.5 medium（聞き返し台本） |
| 2026-11-04 10:16 | claude-opus-5-5 | low | 13/13 (100%) | 2/2 | 11.9 | 1021/1403 | 宛先=医療機関 fixture=sasaki-kiyoshi 3本目（医師宛・佐々木清さん）初回 |
| 2026-11-04 10:28 | claude-opus-5-5 | low | 13/13 (100%) | 2/2 | 12.1 | 1021/1383 | 宛先=医療機関 fixture=sasaki-kiyoshi 服薬管理者の判定目安を追記（セットするのが家族→家族） |
