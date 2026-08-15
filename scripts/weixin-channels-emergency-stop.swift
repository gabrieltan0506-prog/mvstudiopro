import AppKit
import Darwin
import Foundation

final class EmergencyStopDelegate: NSObject, NSApplicationDelegate {
    private let targetPID: pid_t
    private let stopRequestFile: String?
    private let statusFile: String?
    private var panel: NSPanel?
    private var stopButton: NSButton?
    private var sessionLabel: NSTextField?
    private var totalLabel: NSTextField?
    private var monitor: Timer?

    init(
        targetPID: pid_t,
        stopRequestFile: String?,
        statusFile: String?
    ) {
        self.targetPID = targetPID
        self.stopRequestFile = stopRequestFile
        self.statusFile = statusFile
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let formal = stopRequestFile != nil && statusFile != nil
        let size = formal
            ? NSSize(width: 224, height: 126)
            : NSSize(width: 190, height: 64)
        let visible = NSScreen.main?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let frame = NSRect(
            x: visible.minX + 12,
            y: visible.maxY - size.height - 12,
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
        panel.level = .screenSaver
        panel.collectionBehavior = [
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
            .stationary,
        ]
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false

        if formal {
            let status = NSTextField(labelWithString: "状态：采集中")
            status.frame = NSRect(x: 12, y: 78, width: size.width - 24, height: 20)
            status.font = .boldSystemFont(ofSize: 13)
            panel.contentView?.addSubview(status)

            let session = NSTextField(labelWithString: "本轮新增：0")
            session.frame = NSRect(x: 12, y: 56, width: size.width - 24, height: 20)
            session.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium)
            panel.contentView?.addSubview(session)
            sessionLabel = session

            let total = NSTextField(labelWithString: "正式有效总数：读取中")
            total.frame = NSRect(x: 12, y: 34, width: size.width - 24, height: 20)
            total.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium)
            panel.contentView?.addSubview(total)
            totalLabel = total
        }

        let buttonY: CGFloat = formal ? 4 : 10
        let button = NSButton(
            frame: NSRect(x: 12, y: buttonY, width: size.width - 24, height: 30)
        )
        button.title = "停止采集"
        button.bezelStyle = .rounded
        button.contentTintColor = .systemRed
        button.font = .boldSystemFont(ofSize: 15)
        button.target = self
        button.action = #selector(stopCapture)
        panel.contentView?.addSubview(button)
        stopButton = button

        panel.orderFrontRegardless()
        self.panel = panel
        refreshStatus()

        monitor = Timer.scheduledTimer(
            withTimeInterval: 0.5,
            repeats: true
        ) { [weak self] _ in
            guard let self else { return }
            if kill(self.targetPID, 0) != 0 {
                NSApp.terminate(nil)
                return
            }
            self.refreshStatus()
        }
    }

    private func refreshStatus() {
        guard let statusFile else { return }
        guard
            let data = FileManager.default.contents(atPath: statusFile),
            let object = try? JSONSerialization.jsonObject(with: data),
            let status = object as? [String: Any]
        else {
            return
        }
        if let sessionNew = status["sessionNew"] as? Int {
            sessionLabel?.stringValue = "本轮新增：\(sessionNew)"
        }
        if let formalQualifiedTotal = status["formalQualifiedTotal"] as? Int {
            totalLabel?.stringValue = "正式有效总数：\(formalQualifiedTotal)"
        }
    }

    @objc private func stopCapture() {
        stopButton?.isEnabled = false
        stopButton?.title = "正在停止…"
        if let stopRequestFile {
            let payload: [String: Any] = [
                "requestedAt": ISO8601DateFormatter().string(from: Date()),
                "targetPID": Int(targetPID),
                "source": "floating_control",
            ]
            do {
                let data = try JSONSerialization.data(withJSONObject: payload)
                try data.write(
                    to: URL(fileURLWithPath: stopRequestFile),
                    options: .atomic
                )
            } catch {
                stopButton?.title = "停止失败，请重试"
                stopButton?.isEnabled = true
                return
            }
        }
        _ = kill(targetPID, SIGTERM)
        NSApp.terminate(nil)
    }
}

guard CommandLine.arguments.count == 2 || CommandLine.arguments.count == 4,
      let parsedPID = Int32(CommandLine.arguments[1]),
      parsedPID > 0 else {
    fputs(
        "usage: weixin-channels-emergency-stop.swift <pid> [stop-request-file status-file]\n",
        stderr
    )
    exit(2)
}

let stopRequestFile = CommandLine.arguments.count == 4
    ? CommandLine.arguments[2]
    : nil
let statusFile = CommandLine.arguments.count == 4
    ? CommandLine.arguments[3]
    : nil
let app = NSApplication.shared
let delegate = EmergencyStopDelegate(
    targetPID: parsedPID,
    stopRequestFile: stopRequestFile,
    statusFile: statusFile
)
app.setActivationPolicy(.accessory)
app.delegate = delegate
app.run()
