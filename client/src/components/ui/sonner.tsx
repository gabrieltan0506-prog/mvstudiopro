import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // 默认右上角 + 富色（success/error/warning/loading 自带高对比配色）
      // 避免 sonner 默认底部 / 默认主题色和页面背景同色看不见
      position="top-right"
      richColors
      closeButton
      duration={5000}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          zIndex: 99999,
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
