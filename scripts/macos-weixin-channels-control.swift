import AppKit
import ApplicationServices
import Foundation

enum ControlError: Error, CustomStringConvertible {
    case appNotRunning
    case windowNotFound
    case invalidArguments
    case dangerousAvatarRegion

    var description: String {
        switch self {
        case .appNotRunning: return "weixin_channels_app_not_running"
        case .windowNotFound: return "weixin_channels_window_not_found"
        case .invalidArguments: return "usage: control.swift window|focus|move-window-visible|move-relative <x> <y>|click-relative <x> <y>|drag-relative <fromX> <fromY> <toX> <toY>|scroll-relative <x> <y> <delta>|type <text>|key up|down|pageDown|return|escape|closeTab|selectAll|clear"
        case .dangerousAvatarRegion: return "weixin_channels_avatar_region_interaction_blocked"
        }
    }
}

/** 底部左侧头像/作者区是账号安全禁区，任何点击或拖动端点都必须被底层拒绝。 */
func isDangerousAvatarRegion(relX: Double, relY: Double) -> Bool {
    return relX <= 0.42 && relY >= 0.86
}

struct WindowInfo: Codable {
    let windowId: UInt32
    let pid: pid_t
    let owner: String
    let title: String
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

func resolveApp() throws -> NSRunningApplication {
    let bundleIds = ["com.tencent.xinWeChat", "com.tencent.flue.WeChatAppEx"]
    for bundleId in bundleIds {
        if let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first {
            return app
        }
    }
    throw ControlError.appNotRunning
}

func resolveAnyWeChatApp() throws -> NSRunningApplication {
    // 主 WeChat 进程持有键盘焦点；优先激活它，避免每次输入前由
    // WeChatAppEx 子进程抢走刚打开的搜索框焦点。
    let bundleIds = ["com.tencent.xinWeChat", "com.tencent.flue.WeChatAppEx"]
    let apps = bundleIds.flatMap { NSRunningApplication.runningApplications(withBundleIdentifier: $0) }
    guard let app = apps.first(where: { !resolveWindows(for: $0).isEmpty }) ?? apps.first else {
        throw ControlError.appNotRunning
    }
    return app
}

func resolveWindow(for app: NSRunningApplication) throws -> WindowInfo {
    let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let candidates = raw.compactMap { item -> WindowInfo? in
        guard let pid = item[kCGWindowOwnerPID as String] as? pid_t,
              let bounds = item[kCGWindowBounds as String] as? [String: CGFloat],
              let windowId = item[kCGWindowNumber as String] as? UInt32 else { return nil }
        let owner = String(item[kCGWindowOwnerName as String] as? String ?? "")
        let title = String(item[kCGWindowName as String] as? String ?? "")
        let ownerKey = owner.lowercased()
        let belongsToWeChat = pid == app.processIdentifier
            || ownerKey.contains("wechat")
            || ownerKey.contains("weixin")
            || owner.contains("微信")
        guard belongsToWeChat else { return nil }
        let width = Double(bounds["Width"] ?? 0)
        let height = Double(bounds["Height"] ?? 0)
        // 视频号独立窗在用户当前分屏下约 484×768；按可读最小面积识别，
        // 后续点击仍使用窗口边界的相对坐标，不依赖固定像素尺寸。
        guard width >= 360, height >= 500 else { return nil }
        return WindowInfo(
            windowId: windowId,
            pid: pid,
            owner: owner,
            title: title,
            x: Double(bounds["X"] ?? 0),
            y: Double(bounds["Y"] ?? 0),
            width: width,
            height: height
        )
    }
    guard let window = candidates.max(by: {
        let leftIsChannels = $0.title.contains("视频号") || $0.title.contains("視頻號") || $0.title.contains("視窗")
        let rightIsChannels = $1.title.contains("视频号") || $1.title.contains("視頻號") || $1.title.contains("視窗")
        let leftBoost = leftIsChannels ? 10.0 : 1.0
        let rightBoost = rightIsChannels ? 10.0 : 1.0
        return $0.width * $0.height * leftBoost < $1.width * $1.height * rightBoost
    }) else {
        throw ControlError.windowNotFound
    }
    return window
}

func resolveWindows(for app: NSRunningApplication) -> [WindowInfo] {
    let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    return raw.compactMap { item -> WindowInfo? in
        guard let pid = item[kCGWindowOwnerPID as String] as? pid_t,
              let bounds = item[kCGWindowBounds as String] as? [String: CGFloat],
              let windowId = item[kCGWindowNumber as String] as? UInt32 else { return nil }
        let owner = String(item[kCGWindowOwnerName as String] as? String ?? "")
        let title = String(item[kCGWindowName as String] as? String ?? "")
        let ownerKey = owner.lowercased()
        let belongsToWeChat = pid == app.processIdentifier || ownerKey.contains("wechat") || ownerKey.contains("weixin") || owner.contains("微信")
        guard belongsToWeChat else { return nil }
        let width = Double(bounds["Width"] ?? 0)
        let height = Double(bounds["Height"] ?? 0)
        guard width >= 200, height >= 120 else { return nil }
        return WindowInfo(windowId: windowId, pid: pid, owner: owner, title: title, x: Double(bounds["X"] ?? 0), y: Double(bounds["Y"] ?? 0), width: width, height: height)
    }.sorted { $0.width * $0.height > $1.width * $1.height }
}

func postMouseClick(x: Double, y: Double) {
    let point = CGPoint(x: x, y: y)
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(80_000)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
}

func postMouseDrag(fromX: Double, fromY: Double, toX: Double, toY: Double) {
    let source = CGPoint(x: fromX, y: fromY)
    let target = CGPoint(x: toX, y: toY)
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: source, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(80_000)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: source, mouseButton: .left)?.post(tap: .cghidEventTap)
    for step in 1...12 {
        let progress = Double(step) / 12.0
        let point = CGPoint(x: fromX + (toX - fromX) * progress, y: fromY + (toY - fromY) * progress)
        CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(12_000)
    }
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: target, mouseButton: .left)?.post(tap: .cghidEventTap)
}

func postKey(code: CGKeyCode, flags: CGEventFlags = []) {
    let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)
    down?.flags = flags
    down?.post(tap: .cghidEventTap)
    let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
    up?.flags = flags
    up?.post(tap: .cghidEventTap)
}

func postText(_ text: String) {
    let utf16 = Array(text.utf16)
    var offset = 0
    while offset < utf16.count {
        let length = min(20, utf16.count - offset)
        let chunk = Array(utf16[offset..<(offset + length)])
        let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)
        event?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
        event?.post(tap: .cghidEventTap)
        offset += length
        usleep(30_000)
    }
}

do {
    let args = Array(CommandLine.arguments.dropFirst())
    guard let action = args.first else { throw ControlError.invalidArguments }
    let app = try resolveAnyWeChatApp()
    _ = app.activate(options: [.activateAllWindows])
    usleep(250_000)

    switch action {
    case "windows":
        let data = try JSONEncoder().encode(resolveWindows(for: app))
        FileHandle.standardOutput.write(data)
    case "window", "focus":
        let window = try resolveWindow(for: app)
        let data = try JSONEncoder().encode(window)
        FileHandle.standardOutput.write(data)
    case "move-window-visible":
        let window = try resolveWindow(for: app)
        let screen = CGDisplayBounds(CGMainDisplayID())
        let targetX = max(20.0, (Double(screen.width) - window.width) / 2.0)
        let targetY = 30.0
        postMouseDrag(
            fromX: window.x + window.width / 2.0,
            fromY: window.y + 24.0,
            toX: targetX + window.width / 2.0,
            toY: targetY + 24.0
        )
    case "move-relative":
        let window = try resolveWindow(for: app)
        guard args.count == 3, let relX = Double(args[1]), let relY = Double(args[2]),
              (0...1).contains(relX), (0...1).contains(relY) else { throw ControlError.invalidArguments }
        CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(
            x: window.x + window.width * relX,
            y: window.y + window.height * relY
        ), mouseButton: .left)?.post(tap: .cghidEventTap)
    case "click-relative":
        let window = try resolveWindow(for: app)
        guard args.count == 3, let relX = Double(args[1]), let relY = Double(args[2]),
              (0...1).contains(relX), (0...1).contains(relY) else { throw ControlError.invalidArguments }
        guard !isDangerousAvatarRegion(relX: relX, relY: relY) else { throw ControlError.dangerousAvatarRegion }
        postMouseClick(x: window.x + window.width * relX, y: window.y + window.height * relY)
    case "drag-relative":
        let window = try resolveWindow(for: app)
        guard args.count == 5,
              let fromX = Double(args[1]), let fromY = Double(args[2]),
              let toX = Double(args[3]), let toY = Double(args[4]),
              [fromX, fromY, toX, toY].allSatisfy({ (0...1).contains($0) }) else { throw ControlError.invalidArguments }
        guard !isDangerousAvatarRegion(relX: fromX, relY: fromY),
              !isDangerousAvatarRegion(relX: toX, relY: toY) else { throw ControlError.dangerousAvatarRegion }
        postMouseDrag(
            fromX: window.x + window.width * fromX,
            fromY: window.y + window.height * fromY,
            toX: window.x + window.width * toX,
            toY: window.y + window.height * toY
        )
    case "scroll-relative":
        let window = try resolveWindow(for: app)
        guard args.count == 4, let relX = Double(args[1]), let relY = Double(args[2]), let delta = Int32(args[3]),
              (0...1).contains(relX), (0...1).contains(relY) else { throw ControlError.invalidArguments }
        let point = CGPoint(x: window.x + window.width * relX, y: window.y + window.height * relY)
        CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(80_000)
        CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0)?.post(tap: .cghidEventTap)
    case "type":
        guard args.count == 2, !args[1].isEmpty else { throw ControlError.invalidArguments }
        postText(args[1])
    case "key":
        guard args.count == 2 else { throw ControlError.invalidArguments }
        switch args[1] {
        case "up": postKey(code: 126)
        case "down": postKey(code: 125)
        case "pageDown": postKey(code: 121)
        case "return": postKey(code: 36)
        case "escape": postKey(code: 53)
        case "closeTab": postKey(code: 13, flags: .maskCommand)
        case "selectAll": postKey(code: 0, flags: .maskCommand)
        case "delete": postKey(code: 51)
        case "clear":
            postKey(code: 0, flags: .maskCommand)
            usleep(100_000)
            for _ in 0..<100 { postKey(code: 51) }
        default: throw ControlError.invalidArguments
        }
    default:
        throw ControlError.invalidArguments
    }
} catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}
