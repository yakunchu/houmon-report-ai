# 評価履歴

`npm run eval` の実行ごとに 1 行追記されます。

| 日時 | model | effort | 選択式一致率 | S引用 | 所要秒 | in/out tokens | メモ |
|---|---|---|---|---|---|---|---|
| 2026-11-02 16:15 | claude-opus-5-5 | max | — | — | — | — | 失敗: max_tokens  |
| 2026-11-02 16:17 | claude-opus-5-5 | medium | 11/13 (85%) | 4/4 | 19.4 | 927/2183 | 宛先=ケアマネ fixture=yamamoto-hanako Day0 初回（HOUMON_EFFORT 未設定=medium） |
| 2026-11-02 16:19 | claude-opus-5-5 | medium | 13/13 (100%) | 3/3 | 12.7 | 927/1341 | 宛先=ケアマネ fixture=yamamoto-hanako Day0 ルール改訂1（尿頻度・運動・S/O/備考の型） |
| 2026-11-02 16:37 | claude-opus-5-5 | medium | 13/13 (100%) | 3/3 | 17.0 | 927/1929 | 宛先=ケアマネ fixture=yamamoto-hanako ルール改訂2（内容理解OK/要確認の判定） |
| 2026-11-02 16:38 | claude-opus-5-5 | medium | 13/13 (100%) | 3/3 | 21.8 | 1041/2692 | 宛先=ケアマネ fixture=fixture-rikai 架空変種: 説明直後に聞き返し・取り違え（内容理解要確認を期待） |
