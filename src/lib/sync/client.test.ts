import { describe, expect, it } from "vitest";
import { describeRelayServer } from "./client";

describe("describeRelayServer（預け先が同じ Wi-Fi の PC か、インターネット上か）", () => {
  it("localhost・プライベート IP・.local は lan（ポート付きも）", () => {
    for (const h of [
      "localhost:3000",
      "127.0.0.1:3000",
      "192.168.1.20:3000",
      "10.0.0.5:3000",
      "172.16.0.1",
      "172.31.255.1:8080",
      "169.254.1.1",
      "pharmacy-pc.local:3000",
      "pharmacy-pc:3000",
      "[::1]:3000",
    ]) {
      expect(describeRelayServer(h).kind, h).toBe("lan");
    }
  });

  it("公開ホスト名・公開 IP・範囲外のプライベート風 IP は public", () => {
    for (const h of [
      "example.vercel.app",
      "houmon.example.com:443",
      "8.8.8.8",
      "172.32.0.1",
      "172.15.0.1",
      "192.169.1.1",
      "localhost.example.com",
    ]) {
      expect(describeRelayServer(h).kind, h).toBe("public");
    }
  });

  it("host は前後の空白を除いてそのまま返す", () => {
    expect(describeRelayServer(" 192.168.1.20:3000 ").host).toBe("192.168.1.20:3000");
  });
});
