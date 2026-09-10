import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { patchSunoSource } from "./patch-upstream.mjs";

const source = readFileSync(new URL("./fixtures/get-captcha.txt", import.meta.url), "utf8");

function harness({ required = true, token = "test-verification-token", challengeError, pageError, clickError } = {}) {
  const patched = patchSunoSource(source);
  const method = patched.slice(patched.indexOf("  public async getCaptcha"), patched.indexOf("\n  /**", patched.indexOf("  public async getCaptcha")));
  const code = ts.transpileModule(`class Harness {\n${method}\n}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const events = [];
  const logger = { info: () => {} };
  const waitForRequests = (_page, signal) => {
    if (challengeError) return Promise.reject(challengeError);
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("AbortError")), { once: true }));
  };
  const Harness = new Function("logger", "waitForRequests", "createCursor", `${code}; return Harness;`)(logger, waitForRequests, async () => null);
  const instance = new Harness();
  let onGenerate;
  let browserCreated = false;
  const browser = { newPage: async () => page, browser: () => ({ close: async () => { events.push("close"); } }) };
  const page = {
    goto: async () => { if (pageError) throw pageError; },
    waitForResponse: async () => {},
    getByLabel: () => ({ click: async () => {} }),
    locator: selector => ({ first: () => ({ kind: selector.includes("button") ? "button" : "textarea", pressSequentially: async () => {} }) }),
    frameLocator: () => ({ locator: () => ({}) }),
    route: async (pattern, handler) => { assert.equal(pattern, "**/api/generate/v2*/**"); events.push("listen"); onGenerate = handler; },
  };
  instance.captchaRequired = async () => required;
  instance.launchBrowser = async () => { browserCreated = true; return browser; };
  instance.click = async target => {
    if (target.kind !== "button") return;
    events.push("click");
    if (clickError) throw clickError;
    assert.ok(onGenerate, "点击前必须已经注册请求监听");
    if (challengeError) return;
    await onGenerate({
      abort: async () => { events.push("abort"); },
      request: () => ({ headers: () => ({ authorization: "Bearer test-session-token" }), postDataJSON: () => ({ token }) }),
    });
  };
  return { instance, events, browserCreated: () => browserCreated };
}

test("补丁准确命中、禁止重复打补丁，上游漂移时显式失败", () => {
  const patched = patchSunoSource(source);
  assert.throws(() => patchSunoSource(patched), /锚点/);
  assert.throws(() => patchSunoSource(source.replace(".custom-textarea", ".changed")), /锚点/);
  assert.ok(patched.includes("payload: { ...payload, token: payload.token ? '[redacted]' : null }"));
});

test("无需验证时不创建浏览器、不伪造令牌", async () => {
  const h = harness({ required: false });
  assert.equal(await h.instance.getCaptcha(), null);
  assert.equal(h.browserCreated(), false);
});

test("点击立刻发出请求也能捕获；先阻止额外生成，最后关闭本请求浏览器", async () => {
  const h = harness();
  assert.equal(await h.instance.getCaptcha(), "test-verification-token");
  assert.deepEqual(h.events, ["listen", "click", "abort", "close"]);
  assert.equal(h.instance.currentToken, "test-session-token");
});

test("没有令牌不能冒充验证完成，仍中止额外生成并清理", async () => {
  const h = harness({ token: null });
  await assert.rejects(h.instance.getCaptcha(), /SUNO_VERIFICATION_CAPTURE_FAILED/);
  assert.deepEqual(h.events, ["listen", "click", "abort", "close"]);
});

test("验证等待失败会传回调用方，不留下永远 pending 的建单", async () => {
  const h = harness({ challengeError: new Error("No hCaptcha request occurred within 1 minute") });
  await assert.rejects(h.instance.getCaptcha(), /No hCaptcha request/);
  assert.equal(h.events.at(-1), "close");
});

test("页面加载和点击失败都清理，不重开或重复点击", async () => {
  for (const option of [{ pageError: new Error("page failed") }, { clickError: new Error("click failed") }]) {
    const h = harness(option);
    await assert.rejects(h.instance.getCaptcha(), /failed/);
    assert.equal(h.events.filter(e => e === "close").length, 1);
    assert.ok(h.events.filter(e => e === "click").length <= 1);
  }
});
