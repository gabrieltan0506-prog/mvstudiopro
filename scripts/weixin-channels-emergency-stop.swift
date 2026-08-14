import AppKit
import Darwin
import Foundation

final class EmergencyStopDelegate: NSObject, NSApplicationDelegate {
    private let targetPID: pid_t
    private var panel: NSPanel?
    private var monitor: Timer?

    init(targetPID: pid_t) {
        self.targetPID = targetPID
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let size = NSSize(width: 190, height: 64)
        let visible = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let frame = NSRect(
            // 微信双窗占据屏幕中部到右侧；固定在屏幕左上角，不能遮挡
            // 右窗评论抽屉的关闭按钮或任何采集目标。
            x: visible.minX + 24,
            y: visible.maxY - size.height - 24,
            width: size.width,
            height: size.height
        )
        let panel = NSPanel(
            contentRect: frame,
            styleMask: [.titled, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.title = "视频号采集"
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false

        let button = NSButton(frame: NSRect(x: 12, y: 10, width: size.width - 24, height: 34))
        button.title = "立即停止采集"
        button.bezelStyle = .rounded
        button.contentTintColor = .systemRed
        button.font = .boldSystemFont(ofSize: 16)
        button.target = self
        button.action = #selector(stopCapture)
        panel.contentView?.addSubview(button)
        panel.orderFrontRegardless()
        self.panel = panel

        monitor = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self else { return }
            if kill(self.targetPID, 0) != 0 {
                NSApp.terminate(nil)
            }
        }
    }

    @objc private func stopCapture() {
        _ = kill(targetPID, SIGTERM)
        NSApp.terminate(nil)
    }
}

guard CommandLine.arguments.count == 2,
      let parsedPID = Int32(CommandLine.arguments[1]),
      parsedPID > 0 else {
    fputs("usage: weixin-channels-emergency-stop.swift <probe-pid>\n", stderr)
    exit(2)
}

let app = NSApplication.shared
let delegate = EmergencyStopDelegate(targetPID: parsedPID)
app.setActivationPolicy(.accessory)
app.delegate = delegate
app.run()
