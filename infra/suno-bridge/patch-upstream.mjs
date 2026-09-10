import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** 针对已钉死版本做可计数补丁；上游结构变化时构建失败，不静默漏补。 */
function replaceOnce(source, before, after) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`上游补丁锚点数量应为 1，实际为 ${count}`);
  return source.replace(before, after);
}

export function patchSunoSource(source) {
  let patched = replaceOnce(source, "page.locator('.custom-textarea')", "page.locator('.custom-textarea, textarea').first()");
  patched = replaceOnce(patched, "page.locator('button[aria-label=\"Create\"]').locator('div.flex')", "page.locator('button[aria-label=\"Create song\"], button[aria-label=\"Create\"]').first()");
  const start = patched.indexOf("  public async getCaptcha(): Promise<string|null> {");
  const end = patched.indexOf("\n  /**", start + 1);
  if (start < 0 || end < 0) throw new Error("未找到完整的上游交互方法");
  let method = patched.slice(start, end);
  const routeStart = method.indexOf("    return (new Promise((resolve, reject) => {");
  const routeEnd = method.indexOf("\n    }));", routeStart);
  if (routeStart < 0 || routeEnd < 0) throw new Error("未找到生成请求监听块");
  let capture = method.slice(routeStart, routeEnd + "\n    }));".length);
  // 监听必须先注册，且只截获 Suno 生成路径；原请求中止后才收取同页返回值。
  capture = replaceOnce(capture, "    return (new Promise((resolve, reject) => {", "    let resolveCapture!: (token: string | null) => void;\n    let rejectCapture!: (error: Error) => void;\n    const captured = new Promise<string | null>((resolve, reject) => { resolveCapture = resolve; rejectCapture = reject; });\n    await page.route('**/api/generate/v2*/**', async (route: any) => {");
  capture = replaceOnce(capture, "      page.route('**/api/generate/v2/**', async (route: any) => {\n", "");
  capture = replaceOnce(capture, "          logger.info('hCaptcha token received. Closing browser');", "          logger.info('Generation request captured; upstream request aborted');");
  capture = replaceOnce(capture, "          route.abort();\n          browser.browser()?.close();\n          controller.abort();", "          await route.abort();");
  capture = replaceOnce(capture, "          this.currentToken = request.headers().authorization.split('Bearer ').pop();\n          resolve(request.postDataJSON().token);", "          const authorization = request.headers().authorization;\n          if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) this.currentToken = authorization.slice(7);\n          const token = request.postDataJSON()?.token;\n          if (typeof token !== 'string' || !token.trim()) throw new Error('SUNO_VERIFICATION_TOKEN_MISSING');\n          resolveCapture(token);");
  capture = replaceOnce(capture, "          reject(err);", "          rejectCapture(new Error('SUNO_VERIFICATION_CAPTURE_FAILED'));");
  capture = replaceOnce(capture, "      });\n    }));", "    });");
  method = method.slice(0, routeStart) + "    const completed = Promise.race([captured, challenge.then(() => { throw new Error('SUNO_VERIFICATION_INTERRUPTED'); })]);\n    const [token] = await Promise.all([completed, this.click(button)]);\n    return token;\n    } finally {\n      controller.abort();\n      await browser.browser()?.close().catch(() => {});\n    }\n  }";
  method = replaceOnce(method, "    const page = await browser.newPage();", "    const controller = new AbortController();\n    try {\n    const page = await browser.newPage();");
  method = replaceOnce(method, "    this.click(button);\n\n    const controller = new AbortController();\n    new Promise<void>(async (resolve, reject) => {", `${capture}\n    const challenge = (async () => {`);
  method = replaceOnce(method, "    }).catch(e => {\n      browser.browser()?.close();\n      throw e;\n    });", "    })();");
  method = replaceOnce(method, "          resolve();", "          return;");
  method = replaceOnce(method, "          reject(e);", "          throw e;");
  method = replaceOnce(method, "          this.click(frame.locator('.button-submit')).catch(e => {", "          await this.click(frame.locator('.button-submit')).catch(async e => {");
  method = replaceOnce(method, "              this.click(button); // click the Create button again to trigger the CAPTCHA", "              await this.click(button); // 原有可见验证失效后的重试仍受同一请求拦截与清理约束");
  const navigation = method.match(/^    await page\.goto\([^\n]+$/m)?.[0];
  const readiness = method.match(/^    await page\.waitForResponse\([^\n]+$/m)?.[0];
  if (!navigation || !readiness) throw new Error("未找到页面导航与就绪等待");
  const readyCall = readiness.trim().replace(/^await /, "").split("; //")[0];
  const navigateCall = navigation.trim().replace(/^await /, "").replace(/;$/, "").replace("timeout: 0", "timeout: 60000");
  // 沿用原有页面就绪的60秒预算；先装监听，避免加载很快时丢掉project响应。
  method = replaceOnce(method, navigation, `    await Promise.all([${readyCall}, ${navigateCall}]);`);
  method = replaceOnce(method, readiness, "    // 页面就绪已与导航共同等待。");
  patched = patched.slice(0, start) + method + patched.slice(end);
  // 登录/验证码令牌只在请求内存中使用，不随上游 debug 日志写出。
  patched = replaceOnce(patched, "            payload: payload", "            payload: { ...payload, token: payload.token ? '[redacted]' : null }");
  return patched;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2];
  if (!target) throw new Error("需要上游源码路径");
  writeFileSync(target, patchSunoSource(readFileSync(target, "utf8")));
  console.log("Suno 上游补丁已校验并应用");
}
