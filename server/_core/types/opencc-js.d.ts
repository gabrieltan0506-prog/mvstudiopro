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
