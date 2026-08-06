declare module "opencc-js" {
  export type OpenCCLocale = "cn" | "tw" | "twp" | "hk" | "jp" | "t";

  export function Converter(options: {
    from: OpenCCLocale;
    to: OpenCCLocale;
  }): (text: string) => string;

  export function ConverterFactory(...args: unknown[]): (text: string) => string;
  export function CustomConverter(dict: unknown): (text: string) => string;
  export function HTMLConverter(converter: (text: string) => string): unknown;
}

/**
 * 轻量子包：只含繁→简字典（`dist/esm/t2cn.js`，约 68KB），不含 opencc-js 主包
 * 打包进「full」的其余方向字典。shared/ 代码会被前端一起打包，用这条子路径
 * 避免把整份 opencc-js（约 1.1MB）塞进客户端 bundle。
 */
declare module "opencc-js/t2cn" {
  export * from "opencc-js";
}
