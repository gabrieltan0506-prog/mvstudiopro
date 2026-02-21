import { Platform, Alert } from "react-native";
import * as Haptics from "expo-haptics";

/**
 * Cross-platform alert that works on both native and web.
 */
export function showAlert(
  title: string,
  message?: string,
  buttons?: Array<{ text: string; onPress?: () => void; style?: "default" | "cancel" | "destructive" }>
) {
  if (Platform.OS === "web") {
    const msg = message ? `${title}\n\n${message}` : title;
    if (buttons && buttons.length > 1) {
      const confirmed = window.confirm(msg);
      if (confirmed) {
        const okBtn = buttons.find((b) => b.style !== "cancel");
        okBtn?.onPress?.();
      } else {
        const cancelBtn = buttons.find((b) => b.style === "cancel");
        cancelBtn?.onPress?.();
      }
    } else {
      window.alert(msg);
      buttons?.[0]?.onPress?.();
    }
  } else {
    Alert.alert(title, message, buttons);
  }
}

/**
 * Cross-platform haptic feedback - no-op on web.
 */
export function hapticImpact(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  if (Platform.OS !== "web") {
    Haptics.impactAsync(style);
  }
}

export function hapticNotification(type: Haptics.NotificationFeedbackType = Haptics.NotificationFeedbackType.Success) {
  if (Platform.OS !== "web") {
    Haptics.notificationAsync(type);
  }
}

/**
 * Cross-platform clipboard copy.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (Platform.OS === "web") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
        return true;
      } catch {
        return false;
      } finally {
        document.body.removeChild(textarea);
      }
    }
  } else {
    try {
      const Clipboard = await import("expo-clipboard");
      await Clipboard.setStringAsync(text);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Cross-platform share functionality.
 */
export async function shareContent(options: { message: string; title?: string; url?: string }) {
  if (Platform.OS === "web") {
    if (navigator.share) {
      try {
        await navigator.share({
          title: options.title,
          text: options.message,
          url: options.url,
        });
      } catch {
        // User cancelled or not supported
      }
    } else {
      // Fallback: copy to clipboard
      await copyToClipboard(options.message);
      showAlert("已拷贝到剪贴板", "内容已拷贝，您可以手动粘贴分享");
    }
  } else {
    try {
      const Sharing = await import("expo-sharing");
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(options.url || "", {
          dialogTitle: options.title,
        });
      }
    } catch {
      // Sharing not available
    }
  }
}
