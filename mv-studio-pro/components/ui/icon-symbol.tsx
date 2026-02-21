import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolWeight, SymbolViewProps } from "expo-symbols";
import { ComponentProps } from "react";
import { OpaqueColorValue, type StyleProp, type TextStyle } from "react-native";

type IconMapping = Record<string, ComponentProps<typeof MaterialIcons>["name"]>;
type IconSymbolName = keyof typeof MAPPING;

const MAPPING = {
  "house.fill": "home",
  "paperplane.fill": "send",
  "chevron.left.forwardslash.chevron.right": "code",
  "chevron.right": "chevron-right",
  "arrow.left.arrow.right": "compare",
  "music.note": "music-note",
  "waveform": "graphic-eq",
  "person.3.fill": "groups",
  "megaphone.fill": "campaign",
  "video.fill": "videocam",
  "photo.fill": "photo",
  "star.fill": "star",
  "arrow.up.circle.fill": "publish",
  "sparkles": "auto-awesome",
  "slider.horizontal.3": "tune",
  "chart.bar.fill": "bar-chart",
  "clock.fill": "schedule",
  "tag.fill": "label",
  "doc.text.fill": "description",
  "square.and.arrow.up": "share",
  "checkmark.circle.fill": "check-circle",
  "xmark.circle.fill": "cancel",
  "plus.circle.fill": "add-circle",
  "gear": "settings",
  "person.fill": "person",
  "bolt.fill": "bolt",
  "flame.fill": "local-fire-department",
  "play.fill": "play-arrow",
  "pause.fill": "pause",
  "film": "movie",
  "music.note.list": "queue-music",
  "arrow.down.circle.fill": "file-download",
  "emoji-events": "emoji-events",
  "trophy.fill": "emoji-events",
  "video-library": "video-library",
  "local-fire-department": "local-fire-department",
  "wand.and.stars": "auto-fix-high",
  "figure.walk": "directions-walk",
  "mouth.fill": "record-voice-over",
  "rectangle.stack.fill": "layers",
  "cube.fill": "view-in-ar",
  "arrow.triangle.2.circlepath": "sync",
  "info.circle.fill": "info",
  "exclamationmark.triangle.fill": "warning",
  "creditcard.fill": "credit-card",
  "key.fill": "vpn-key",
  "cloud.fill": "cloud",
  "arrow.clockwise": "refresh",
  "trash.fill": "delete",
  "pencil": "edit",
  "eye.fill": "visibility",
  "photo.on.rectangle": "collections",
  "camera.fill": "photo-camera",
  "mic.fill": "mic",
  "speaker.wave.2.fill": "volume-up",
} as IconMapping;

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
