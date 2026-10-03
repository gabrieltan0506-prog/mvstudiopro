import { forwardRef, type ChangeEvent, type TextareaHTMLAttributes } from "react";
import { maskedUrlEditorValue } from "@/lib/maskMediaUrls";

/** 提示词可编辑；网址仅显示遮罩，向上游回传原始链接。 */
export const UrlMaskedTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function UrlMaskedTextarea({ value, onChange, ...props }, ref) {
    const masked = maskedUrlEditorValue(String(value ?? ""));
    return <textarea {...props} ref={ref} value={masked.value} onChange={event => {
      const restored = masked.restore(event.target.value);
      if (restored == null) return;
      const target = new Proxy(event.target, {
        get(node, key) {
          if (key === "value") return restored;
          const result = Reflect.get(node, key, node);
          return typeof result === "function" ? result.bind(node) : result;
        },
      });
      const original = Object.assign(Object.create(event), { target, currentTarget: target }) as ChangeEvent<HTMLTextAreaElement>;
      onChange?.(original);
    }} />;
  },
);
