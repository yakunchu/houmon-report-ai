import { describe, expect, it } from "vitest";
import { syncEnabled } from "./http";

describe("syncEnabled（HOUMON_SYNC=on と明示したときだけ有効）", () => {
  it("未設定・空・off・false・0・no・その他の値は無効", () => {
    for (const v of [undefined, "", " ", "off", "OFF", "false", "0", "no", "yes", "true", "1", "onn"]) {
      expect(syncEnabled({ HOUMON_SYNC: v })).toBe(false);
    }
    expect(syncEnabled({})).toBe(false);
  });

  it("on（大文字小文字・前後の空白は無視）だけが有効", () => {
    for (const v of ["on", "ON", "On", " on "]) expect(syncEnabled({ HOUMON_SYNC: v })).toBe(true);
  });
});
