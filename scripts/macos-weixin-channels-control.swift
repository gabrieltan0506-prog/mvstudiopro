import AppKit
import ApplicationServices
import Foundation

enum ControlError: Error, CustomStringConvertible {
    case appNotRunning
    case windowNotFound
    case invalidArguments
    case dangerousAvatarRegion
    case dangerousTabCloseRegion

    var description: String {
        switch self {
        case .appNotRunning: return "weixin_channels_app_not_running"
        case .windowNotFound: return "weixin_channels_window_not_found"
        case .invalidArguments: return "usage: control.swift [--window-id <id>] window|focus|calibrate-point <label>|move-window-visible|move-relative <x> <y>|click-relative <x> <y>|click-relative-after-hover <x> <y>|open-search-and-type <x> <y> <text>|click-confirmed-search-submit <x> <y>|click-confirmed-search-tab-close <x> <y>|click-confirmed-personal-data-tab-close <x> <y>|click-confirmed-comments-close <x> <y>|drag-relative <fromX> <fromY> <toX> <toY>|scroll-relative <x> <y> <delta>|type <text>|key up|down|home|pageDown|return|escape|closeTab|selectAll|clear"
        case .dangerousAvatarRegion: return "weixin_channels_avatar_region_interaction_blocked"
        case .dangerousTabCloseRegion: return "weixin_channels_tab_close_interaction_blocked"
        }
    }
}

/** 底部左侧头像/作者区是账号安全禁区，任何点击或拖动端点都必须被底层拒绝。 */
func isDangerousAvatarRegion(relX: Double, relY: Double) -> Bool {
    let authorAvatar = relX >= 0 && relX <= 0.42 && relY >= 0.86 && relY <= 1
    let personalProfile = relX >= 0.84 && relX <= 1 && relY >= 0.06 && relY <= 0.18
    return authorAvatar || personalProfile
}

/** 视频号/搜索标签顶栏的 X 永久禁点；搜索页只可在页面身份确认后用快捷键关闭。 */
func isDangerousTabCloseRegion(relX: Double, relY: Double) -> Bool {
    guard relY >= 0 && relY <= 0.075 else { return false }
    // 单标签/双标签布局中关闭符号落在这两个窄槽位；标签文字本身仍可点击切换。
    return (relX >= 0.50 && relX <= 0.55) || (relX >= 0.66 && relX <= 0.72)
}

func dragCrossesDangerousAvatarRegion(fromX: Double, fromY: Double, toX: Double, toY: Double) -> Bool {
    for step in 0...24 {
        let progress = Double(step) / 24.0
        if isDangerousAvatarRegion(
            relX: fromX + (toX - fromX) * progress,
            relY: fromY + (toY - fromY) * progress
        ) { return true }
    }
    return false
}

func pointerPathCrossesDangerousAvatarRegion(window: WindowInfo, toX: Double, toY: Double, allowEscape: Bool = false) -> Bool {
    guard let location = CGEvent(source: nil)?.location else { return true }
    let fromX = (Double(location.x) - window.x) / window.width
    let fromY = (Double(location.y) - window.y) / window.height
    if allowEscape && isDangerousAvatarRegion(relX: fromX, relY: fromY)
        && !isDangerousAvatarRegion(relX: toX, relY: toY) { return false }
    return dragCrossesDangerousAvatarRegion(fromX: fromX, fromY: fromY, toX: toX, toY: toY)
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

struct CalibrationPoint: Codable {
    let x: Double
    let y: Double
}

final class CalibrationOverlayWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class CalibrationOverlayView: NSView {
    let label: String
    var onPoint: ((CalibrationPoint) -> Void)?

    init(frame: NSRect, label: String) {
        self.label = label
        super.init(frame: frame)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override var acceptsFirstResponder: Bool { true }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .crosshair)
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.systemGreen.withAlphaComponent(0.85).setStroke()
        let border = NSBezierPath(rect: bounds.insetBy(dx: 2, dy: 2))
        border.lineWidth = 3
        border.stroke()

        let message = "点击放大镜"
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 14, weight: .semibold),
            .foregroundColor: NSColor.white,
            .backgroundColor: NSColor.black.withAlphaComponent(0.78),
        ]
        message.draw(
            in: NSRect(
                x: 16,
                y: bounds.height - 42,
                width: 160,
                height: 26
            ),
            withAttributes: attributes
        )
    }

    override func mouseDown(with event: NSEvent) {
        guard let overlayWindow = self.window else { return }
        let point = overlayWindow.convertPoint(toScreen: event.locationInWindow)
        let frame = overlayWindow.frame
        let relative = CalibrationPoint(
            x: Double((point.x - frame.minX) / frame.width),
            y: 1 - Double((point.y - frame.minY) / frame.height)
        )
        FileHandle.standardError.write(Data(
            "calibration_click:{\"x\":\(relative.x),\"y\":\(relative.y)}\n".utf8
        ))
        // 只接受顶部右侧方框放大镜的大范围。误点中央说明、视频号标签或
        // 标签 X 时保持校准层不动，让用户可以直接重试，不保存错误坐标。
        guard relative.x >= 0.68,
              relative.x <= 0.90,
              relative.y >= 0.005,
              relative.y <= 0.075,
              !isDangerousTabCloseRegion(relX: relative.x, relY: relative.y),
              !isDangerousAvatarRegion(relX: relative.x, relY: relative.y) else {
            return
        }
        onPoint?(relative)
    }
}

func captureCalibrationPoint(window: WindowInfo, label: String) throws -> CalibrationPoint {
    guard let screen = NSScreen.screens.first(where: { screen in
        let cgMidX = window.x + window.width / 2
        let cgMidY = window.y + window.height / 2
        let cocoaMidY = screen.frame.maxY - cgMidY
        return screen.frame.contains(NSPoint(x: cgMidX, y: cocoaMidY))
    }) ?? NSScreen.main else {
        throw ControlError.windowNotFound
    }
    let frame = NSRect(
        x: window.x,
        y: Double(screen.frame.maxY) - window.y - window.height,
        width: window.width,
        height: window.height
    )
    let overlay = CalibrationOverlayWindow(
        contentRect: frame,
        styleMask: .borderless,
        backing: .buffered,
        defer: false
    )
    overlay.isOpaque = false
    overlay.backgroundColor = .clear
    overlay.hasShadow = false
    overlay.ignoresMouseEvents = false
    overlay.acceptsMouseMovedEvents = true
    overlay.level = .floating
    overlay.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    let view = CalibrationOverlayView(
        frame: NSRect(origin: .zero, size: frame.size),
        label: label
    )
    var result: CalibrationPoint?
    view.onPoint = { point in
        result = point
        overlay.orderOut(nil)
        NSApp.stop(nil)
    }
    overlay.contentView = view
    NSApp.setActivationPolicy(.accessory)
    overlay.makeKeyAndOrderFront(nil)
    overlay.makeFirstResponder(view)
    NSApp.activate(ignoringOtherApps: true)
    NSApp.run()
    guard let result,
          result.x >= 0.68,
          result.x <= 0.90,
          result.y >= 0.005,
          result.y <= 0.075,
          !isDangerousTabCloseRegion(relX: result.x, relY: result.y),
          !isDangerousAvatarRegion(relX: result.x, relY: result.y) else {
        throw ControlError.invalidArguments
    }
    return result
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

func resolveWindow(
    for app: NSRunningApplication,
    requestedWindowId: UInt32? = nil,
    requestedWindowPid: pid_t? = nil
) throws -> WindowInfo {
    let weChatPids = Set(["com.tencent.xinWeChat", "com.tencent.flue.WeChatAppEx"]
        .flatMap { NSRunningApplication.runningApplications(withBundleIdentifier: $0) }
        .map(\.processIdentifier))
    let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let candidates = raw.compactMap { item -> WindowInfo? in
        guard let pid = item[kCGWindowOwnerPID as String] as? pid_t,
              let bounds = item[kCGWindowBounds as String] as? [String: CGFloat],
              let windowId = item[kCGWindowNumber as String] as? UInt32 else { return nil }
        let owner = String(item[kCGWindowOwnerName as String] as? String ?? "")
        let title = String(item[kCGWindowName as String] as? String ?? "")
        guard requestedWindowId == nil ? pid == app.processIdentifier : weChatPids.contains(pid) else { return nil }
        if let requestedWindowPid, pid != requestedWindowPid { return nil }
        let width = Double(bounds["Width"] ?? 0)
        let height = Double(bounds["Height"] ?? 0)
        // 视频号独立窗在用户当前分屏下约 484×768；按可读最小面积识别，
        // 后续点击仍使用窗口边界的相对坐标，不依赖固定像素尺寸。
        let explicitGenericWindow = requestedWindowId == windowId && title == "WeChat (視窗)"
        guard width >= 360, height >= 500, height >= width * 1.25,
              title.contains("视频号") || title.contains("視頻號") || explicitGenericWindow else { return nil }
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
    if let requestedWindowId {
        guard let requested = candidates.first(where: { $0.windowId == requestedWindowId }) else {
            throw ControlError.windowNotFound
        }
        return requested
    }
    // 单窗口兼容只允许唯一候选；出现两个窗口而调用方未传 ID 时必须失败，
    // 绝不按面积、层级或数组顺序猜测左右窗口。
    guard candidates.count == 1 else { throw ControlError.windowNotFound }
    guard let window = candidates.max(by: {
        let leftIsChannels = $0.title.contains("视频号") || $0.title.contains("視頻號")
        let rightIsChannels = $1.title.contains("视频号") || $1.title.contains("視頻號")
        let leftBoost = leftIsChannels ? 10.0 : 1.0
        let rightBoost = rightIsChannels ? 10.0 : 1.0
        return $0.width * $0.height * leftBoost < $1.width * $1.height * rightBoost
    }) else {
        throw ControlError.windowNotFound
    }
    return window
}

/**
 * 键盘事件没有窗口参数；必须先通过辅助功能树把与 CGWindow 几何一致的
 * 微信窗口置前。匹配失败时返回 false，调用方必须中止，不能把按键发给另一窗。
 */
func axWindowMatchesBounds(_ axWindow: AXUIElement, _ window: WindowInfo) -> Bool {
    var positionValue: CFTypeRef?
    var sizeValue: CFTypeRef?
    guard AXUIElementCopyAttributeValue(axWindow, kAXPositionAttribute as CFString, &positionValue) == .success,
          AXUIElementCopyAttributeValue(axWindow, kAXSizeAttribute as CFString, &sizeValue) == .success,
          let positionValue, let sizeValue,
          CFGetTypeID(positionValue) == AXValueGetTypeID(),
          CFGetTypeID(sizeValue) == AXValueGetTypeID() else { return false }
    let positionAx = unsafeBitCast(positionValue, to: AXValue.self)
    let sizeAx = unsafeBitCast(sizeValue, to: AXValue.self)
    var position = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(positionAx, .cgPoint, &position),
          AXValueGetValue(sizeAx, .cgSize, &size) else { return false }
    return abs(Double(position.x) - window.x) <= 4
        && abs(Double(position.y) - window.y) <= 4
        && abs(Double(size.width) - window.width) <= 4
        && abs(Double(size.height) - window.height) <= 4
}

/** AXWindowNumber 与 CGWindowNumber 是同一个系统 ID；可用时必须优先精确匹配。 */
func axWindowMatchesId(_ axWindow: AXUIElement, _ window: WindowInfo) -> Bool {
    var numberValue: CFTypeRef?
    guard AXUIElementCopyAttributeValue(
        axWindow,
        "AXWindowNumber" as CFString,
        &numberValue
    ) == .success else { return false }
    if let number = numberValue as? NSNumber {
        return number.uint32Value == window.windowId
    }
    return false
}

func axWindowMatches(_ axWindow: AXUIElement, _ window: WindowInfo) -> Bool {
    return axWindowMatchesId(axWindow, window) || axWindowMatchesBounds(axWindow, window)
}

func raiseExactWindow(_ window: WindowInfo) -> Bool {
    let application = AXUIElementCreateApplication(window.pid)
    var windowsValue: CFTypeRef?
    guard AXUIElementCopyAttributeValue(application, kAXWindowsAttribute as CFString, &windowsValue) == .success,
          let axWindows = windowsValue as? [AXUIElement] else { return false }
    for axWindow in axWindows {
        if axWindowMatches(axWindow, window) {
            guard AXUIElementPerformAction(axWindow, kAXRaiseAction as CFString) == .success else { return false }
            usleep(80_000)
            var focusedValue: CFTypeRef?
            guard AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute as CFString, &focusedValue) == .success,
                  let focusedValue,
                  CFGetTypeID(focusedValue) == AXUIElementGetTypeID() else { return false }
            let focusedWindow = unsafeBitCast(focusedValue, to: AXUIElement.self)
            return axWindowMatches(focusedWindow, window)
        }
    }
    return false
}

func resolveWindows(for app: NSRunningApplication) -> [WindowInfo] {
    let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    return raw.compactMap { item -> WindowInfo? in
        guard let pid = item[kCGWindowOwnerPID as String] as? pid_t,
              let bounds = item[kCGWindowBounds as String] as? [String: CGFloat],
              let windowId = item[kCGWindowNumber as String] as? UInt32 else { return nil }
        let owner = String(item[kCGWindowOwnerName as String] as? String ?? "")
        let title = String(item[kCGWindowName as String] as? String ?? "")
        guard pid == app.processIdentifier else { return nil }
        let width = Double(bounds["Width"] ?? 0)
        let height = Double(bounds["Height"] ?? 0)
        guard width >= 360, height >= 500, height >= width * 1.25,
              title.contains("视频号") || title.contains("視頻號") || title == "WeChat (視窗)" else { return nil }
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
    var args = Array(CommandLine.arguments.dropFirst())
    var requestedWindowId: UInt32?
    var requestedWindowPid: pid_t?
    if args.first == "--window-id" {
        guard args.count >= 3, let parsed = UInt32(args[1]), parsed > 0 else {
            throw ControlError.invalidArguments
        }
        requestedWindowId = parsed
        args.removeFirst(2)
    }
    if args.first == "--window-pid" {
        guard args.count >= 3, let parsed = Int32(args[1]), parsed > 0 else {
            throw ControlError.invalidArguments
        }
        requestedWindowPid = parsed
        args.removeFirst(2)
    }
    guard let action = args.first else { throw ControlError.invalidArguments }
    if action != "windows" && ((requestedWindowId == nil) != (requestedWindowPid == nil)) {
        throw ControlError.invalidArguments
    }
    let app = try resolveAnyWeChatApp()
    let selectedWindow = action == "windows" ? nil : try resolveWindow(
        for: app,
        requestedWindowId: requestedWindowId,
        requestedWindowPid: requestedWindowPid
    )
    if let selectedWindow {
        _ = app.activate(options: [])
        guard raiseExactWindow(selectedWindow) else { throw ControlError.windowNotFound }
        usleep(250_000)
    }

    switch action {
    case "windows":
        let data = try JSONEncoder().encode(resolveWindows(for: app))
        FileHandle.standardOutput.write(data)
    case "window", "focus":
        guard let window = selectedWindow else { throw ControlError.windowNotFound }
        let data = try JSONEncoder().encode(window)
        FileHandle.standardOutput.write(data)
    case "calibrate-point":
        guard let window = selectedWindow, args.count == 2, !args[1].isEmpty else {
            throw ControlError.invalidArguments
        }
        let point = try captureCalibrationPoint(window: window, label: args[1])
        let data = try JSONEncoder().encode(point)
        FileHandle.standardOutput.write(data)
    case "move-window-visible":
        guard let window = selectedWindow else { throw ControlError.windowNotFound }
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
        guard let window = selectedWindow else { throw ControlError.windowNotFound }
        guard args.count == 3, let relX = Double(args[1]), let relY = Double(args[2]),
              (0...1).contains(relX), (0...1).contains(relY) else { throw ControlError.invalidArguments }
        guard !isDangerousAvatarRegion(relX: relX, relY: relY) else { throw ControlError.dangerousAvatarRegion }
        // 纯移动不会触发点击。双窗交替时鼠标常从另一窗口出发，把那段屏幕
        // 路径投影到当前窗口会产生假的头像穿越；只需保证最终悬停点不在禁区。
        // click/drag 仍继续执行完整路径门禁。
        CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(
            x: window.x + window.width * relX,
            y: window.y + window.height * relY
        ), mouseButton: .left)?.post(tap: .cghidEventTap)
    case "click-relative":
        guard let window = selectedWindow else { throw ControlError.windowNotFound }
        guard args.count == 3, let relX = Double(args[1]), let relY = Double(args[2]),
              (0...1).contains(relX), (0...1).contains(relY) else { throw ControlError.invalidArguments }
        guard !isDangerousAvatarRegion(relX: relX, relY: relY) else { throw ControlError.dangerousAvatarRegion }
        guard !isDangerousTabCloseRegion(relX: relX, relY: relY) else { throw ControlError.dangerousTabCloseRegion }
        if pointerPathCrossesDangerousAvatarRegion(window: window, toX: relX, toY: relY) {
            let safe = CGPoint(x: window.x + window.width * 0.02, y: window.y + window.height * 0.50)
            CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: safe, mouseButton: .left)?.post(tap: .cghidEventTap)
            usleep(80_000)
        }
        guard !pointerPathCrossesDangerousAvatarRegion(window: window, toX: relX, toY: relY) else {
            throw ControlError.dangerousAvatarRegion
        }
        postMouseClick(x: window.x + window.width * relX, y: window.y + window.height * relY)
    case "click-relative-after-hover":
        guard let window = selectedWindow else { throw ControlError.windowNotFound }
        guard args.count == 3, let relX = Double(args[1]), let relY = Double(args[2]),
              (0...1).contains(relX), (0...1).contains(relY) else { throw ControlError.invalidArguments }
        guard !isDangerousAvatarRegion(relX: relX, relY: relY) else { throw ControlError.dangerousAvatarRegion }
        guard !isDangerousTabCloseRegion(relX: relX, relY: relY) else { throw ControlError.dangerousTabCloseRegion }
        guard !pointerPathCrossesDangerousAvatarRegion(window: window, toX: relX, toY: relY) else {
            throw ControlError.dangerousAvatarRegion
        }
        let target = CGPoint(
            x: window.x + window.width * relX,
            y: window.y + window.height * relY
        )
        CGEvent(
            mouseEventSource: nil,
            mouseType: .mouseMoved,
            mouseCursorPosition: target,
            mouseButton: .left
        )?.post(tap: .cghidEventTap)
        usleep(350_000)
        postMouseClick(x: target.x, y: target.y)
    case "open-search-and-type":
        guard let window = selectedWindow else { throw ControlError.windowNotFound }
        guard args.count == 4, let relX = Double(args[1]), let relY = Double(args[2]),
              !args[3].isEmpty, (0...1).contains(relX), (0...1).contains(relY) else {
            throw ControlError.invalidArguments
        }
        guard !isDangerousAvatarRegion(relX: relX, relY: relY),
              !isDangerousTabCloseRegion(relX: relX, relY: relY),
              !pointerPathCrossesDangerousAvatarRegion(window: window, toX: relX, toY: relY) else {
            throw ControlError.dangerousAvatarRegion
        }
        let target = CGPoint(
            x: window.x + window.width * relX,
            y: window.y + window.height * relY
        )
        CGEvent(
            mouseEventSource: nil,
            mouseType: .mouseMoved,
            mouseCursorPosition: target,
            mouseButton: .left
        )?.post(tap: .cghidEventTap)
        usleep(350_000)
        postMouseClick(x: target.x, y: target.y)
        usleep(180_000)
        postKey(code: 0, flags: .maskCommand)
        usleep(100_000)
        postKey(code: 51)
        usleep(100_000)
        postText(args[3])
        usleep(300_000)
        postKey(code: 36)
    case "click-confirmed-search-submit":
        guard let window = selectedWindow else { throw ControlError.windowNotFound }
        guard args.count == 3,
              let relX = Double(args[1]),
              let relY = Double(args[2]),
              relX >= 0.75,
              relX <= 0.95,
              relY >= 0.075,
              relY <= 0.16,
              !isDangerousTabCloseRegion(relX: relX, relY: relY) else {
            throw ControlError.invalidArguments
        }
        // 搜索页绿色提交按钮与播放器头像禁区重叠。普通点击仍永久拒绝；只有
        // 调用方已 OCR 证明“关键词 + 搜索/搜尋”时才允许此专用动作。
        if pointerPathCrossesDangerousAvatarRegion(window: window, toX: relX, toY: relY) {
            let safe = CGPoint(x: window.x + window.width * 0.02, y: window.y + window.height * 0.50)
            CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: safe, mouseButton: .left)?.post(tap: .cghidEventTap)
            usleep(80_000)
        }
        postMouseClick(x: window.x + window.width * relX, y: window.y + window.height * relY)
    case "click-confirmed-search-tab-close":
        guard let window = selectedWindow else { throw ControlError.windowNotFound }
        guard args.count == 3,
              let relX = Double(args[1]),
              let relY = Double(args[2]),
              relX >= 0.66,
              relX <= 0.72,
              relY >= 0.005,
              relY <= 0.065,
              isDangerousTabCloseRegion(relX: relX, relY: relY),
              !isDangerousAvatarRegion(relX: relX, relY: relY) else {
            throw ControlError.invalidArguments
        }
        // 搜索结束后允许关闭搜索标签，但调用方必须先用整页 OCR 证明搜索页，
        // 并识别搜索标签同行最右侧的 X。视频号自己的左侧 X 槽永不放行。
        if pointerPathCrossesDangerousAvatarRegion(window: window, toX: relX, toY: relY) {
            let safe = CGPoint(x: window.x + window.width * 0.02, y: window.y + window.height * 0.50)
            CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: safe, mouseButton: .left)?.post(tap: .cghidEventTap)
            usleep(80_000)
        }
        guard !pointerPathCrossesDangerousAvatarRegion(window: window, toX: relX, toY: relY) else {
            throw ControlError.dangerousAvatarRegion
        }
        postMouseClick(x: window.x + window.width * relX, y: window.y + window.height * relY)
        usleep(120_000)
        // 搜索标签关闭后，剩余“视频号”标签会自动变宽，它自己的 X 可能正好
        // 移到原鼠标位置。立即移到左侧中部，避免后续点击误关采集窗口。
        CGEvent(
            mouseEventSource: nil,
            mouseType: .mouseMoved,
            mouseCursorPosition: CGPoint(
                x: window.x + window.width * 0.02,
                y: window.y + window.height * 0.50
            ),
            mouseButton: .left
        )?.post(tap: .cghidEventTap)
    case "click-confirmed-personal-data-tab-close":
        guard let window = selectedWindow else { throw ControlError.windowNotFound }
        guard args.count == 3, let relX = Double(args[1]), let relY = Double(args[2]),
              relX >= 0.60, relX <= 0.76, relY >= 0.005, relY <= 0.065,
              isDangerousTabCloseRegion(relX: relX, relY: relY),
              !isDangerousAvatarRegion(relX: relX, relY: relY) else { throw ControlError.invalidArguments }
        // 这是唯一允许触碰顶栏 X 的底层动作；调用方必须先用整页 OCR 严格证明
        // 当前为“赞和收藏”个人数据页。若鼠标仍停在头像禁区，只移动离开，不点击。
        if pointerPathCrossesDangerousAvatarRegion(window: window, toX: relX, toY: relY) {
            let safe = CGPoint(x: window.x + window.width * 0.02, y: window.y + window.height * 0.50)
            CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: safe, mouseButton: .left)?.post(tap: .cghidEventTap)
            usleep(80_000)
        }
        guard !pointerPathCrossesDangerousAvatarRegion(window: window, toX: relX, toY: relY) else {
            throw ControlError.dangerousAvatarRegion
        }
        postMouseClick(x: window.x + window.width * relX, y: window.y + window.height * relY)
    case "click-confirmed-comments-close":
        guard let window = selectedWindow else { throw ControlError.windowNotFound }
        guard args.count == 3, let relX = Double(args[1]), let relY = Double(args[2]),
              relX >= 0.84, relX <= 0.99, relY >= 0.045, relY <= 0.145 else {
            throw ControlError.invalidArguments
        }
        // 评论抽屉 X 与个人头像坐标重叠；普通 click-relative 永久拒绝该区域。
        // 只有调用方已用“评论标题 + 同行 X”证明抽屉存在时，才走此专用动作。
        if pointerPathCrossesDangerousAvatarRegion(window: window, toX: relX, toY: relY) {
            let safe = CGPoint(x: window.x + window.width * 0.02, y: window.y + window.height * 0.50)
            CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: safe, mouseButton: .left)?.post(tap: .cghidEventTap)
            usleep(80_000)
        }
        postMouseClick(x: window.x + window.width * relX, y: window.y + window.height * relY)
    case "drag-relative":
        guard let window = selectedWindow else { throw ControlError.windowNotFound }
        guard args.count == 5,
              let fromX = Double(args[1]), let fromY = Double(args[2]),
              let toX = Double(args[3]), let toY = Double(args[4]),
              [fromX, fromY, toX, toY].allSatisfy({ (0...1).contains($0) }) else { throw ControlError.invalidArguments }
        guard !dragCrossesDangerousAvatarRegion(fromX: fromX, fromY: fromY, toX: toX, toY: toY) else {
            throw ControlError.dangerousAvatarRegion
        }
        // 双窗交错会让全局鼠标停在另一窗口。拖动本身的起终点都安全时，
        // 先在同一次 Swift 原子动作内归位到本窗左侧安全点，再检查并拖动；
        // 禁止把跨窗口的旧鼠标起点误判成当前窗口头像路径。
        if pointerPathCrossesDangerousAvatarRegion(window: window, toX: fromX, toY: fromY) {
            let safe = CGPoint(
                x: window.x + window.width * 0.02,
                y: window.y + window.height * 0.50
            )
            CGEvent(
                mouseEventSource: nil,
                mouseType: .mouseMoved,
                mouseCursorPosition: safe,
                mouseButton: .left
            )?.post(tap: .cghidEventTap)
            usleep(80_000)
        }
        guard !pointerPathCrossesDangerousAvatarRegion(window: window, toX: fromX, toY: fromY) else {
            throw ControlError.dangerousAvatarRegion
        }
        postMouseDrag(
            fromX: window.x + window.width * fromX,
            fromY: window.y + window.height * fromY,
            toX: window.x + window.width * toX,
            toY: window.y + window.height * toY
        )
    case "scroll-relative":
        guard let window = selectedWindow else { throw ControlError.windowNotFound }
        guard args.count == 4, let relX = Double(args[1]), let relY = Double(args[2]), let delta = Int32(args[3]),
              (0...1).contains(relX), (0...1).contains(relY) else { throw ControlError.invalidArguments }
        guard !isDangerousAvatarRegion(relX: relX, relY: relY) else { throw ControlError.dangerousAvatarRegion }
        // 滚轮与纯移动不会产生点击；只校验最终悬停点。跨窗时鼠标从另一窗口
        // 移到安全滚动点，其屏幕路径可能投影经过本窗头像区，不能据此误拒绝。
        // click/drag 仍在各自动作中校验完整路径和禁区。
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
        case "home": postKey(code: 115)
        case "pageDown": postKey(code: 121)
        case "return": postKey(code: 36)
        case "escape": postKey(code: 53)
        case "back": postKey(code: 33, flags: .maskCommand)
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
