import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Platform } from "react-native";
import { useColors } from "@/hooks/use-colors";

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const bottomPadding = isWeb ? 12 : Math.max(insets.bottom, 8);
  const tabBarHeight = 56 + bottomPadding;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#FF8C42",
        headerShown: false,
        tabBarButton: HapticTab,
        // Hide tab bar on web - use top nav instead
        tabBarStyle: isWeb
          ? { display: "none" }
          : {
              paddingTop: 8,
              paddingBottom: bottomPadding,
              height: tabBarHeight,
              backgroundColor: "#0A0A10",
              borderTopColor: "rgba(168,85,247,0.12)",
              borderTopWidth: 0.5,
            },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="pricing"
        options={{
          title: "套餐",
          tabBarIcon: ({ color }) => <MaterialIcons name="shopping-cart" size={28} color={color} />,
        }}
      />
      <Tabs.Screen
        name="storyboard"
        options={{
          title: "分镜脚本",
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="paperplane.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="analyze"
        options={{
          title: "视频PK评分",
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="waveform" color={color} />,
          href: null, // Hide from tab bar
        }}
      />
      <Tabs.Screen
        name="avatar"
        options={{
          title: "虚拟偶像",
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="person.3.fill" color={color} />,
          href: null, // Hide from tab bar
        }}
      />
      <Tabs.Screen
        name="publish"
        options={{
          title: "发布策略",
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="megaphone.fill" color={color} />,
          href: null, // Hide from tab bar
        }}
      />
      <Tabs.Screen
        name="3d-studio"
        options={{
          title: "2D转3D",
          tabBarIcon: ({ color }) => <MaterialIcons name="view-in-ar" size={28} color={color} />,
        }}
      />
    </Tabs>
  );
}
