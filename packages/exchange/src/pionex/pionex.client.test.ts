import { buildPionexSignature } from "./pionex.client.js";

describe("pionex signature", () => {
  it("signs GET payload (method + path_url)", () => {
    const payload = "GET/api/v1/trade/openOrders?symbol=BTC_USDT&timestamp=1655896754515";
    const sig = buildPionexSignature(payload, "secret");
    expect(sig).toBe("b8e0f840737aa0270ac9d2d80a358deb8c53dc6ff3d90c0673ed8ce8098b51be");
  });

  it("signs POST payload (method + path_url + body)", () => {
    const body = JSON.stringify({
      symbol: "BTC_USDT",
      side: "BUY",
      type: "LIMIT",
      price: "30000",
      size: "1"
    });
    const payload = `POST/api/v1/trade/order?timestamp=1655896754515${body}`;
    const sig = buildPionexSignature(payload, "secret");
    expect(sig).toBe("164bd34bff4caaabf4fff9274327de7b32b7f8c231ef67a969aecdc6ac415ec3");
  });
});
