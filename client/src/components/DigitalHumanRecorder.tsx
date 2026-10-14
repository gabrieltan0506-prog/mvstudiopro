import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { DIGITAL_HUMAN_RECORDING_READ_TEXT } from "@shared/digitalHumanRecording";
import { encodeDigitalHumanWav } from "@/lib/digitalHumanWav";

/** 录音仅暂存在本页；用户试听、确认使用权并采用后才交给上传入口。 */
export function DigitalHumanRecorder({
  onClose,
  onUse,
  disabled = false,
}: {
  onClose: () => void;
  onUse: (file: File) => Promise<void>;
  disabled?: boolean;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  useEffect(() => {
    let active = true;
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then(items => {
        if (!active) return;
        const inputs = items.filter(
          item =>
            item.kind === "audioinput" &&
            !/virtual|filmage|blackhole|loopback/i.test(item.label) &&
            !["default", "communications"].includes(item.deviceId)
        );
        setDevices(inputs);
        const builtin = inputs.find(item =>
          /built.?in|内置|內建|內置|macbook.*mic/i.test(item.label)
        );
        setDeviceId(builtin?.deviceId || "");
      })
      .catch(() => {
        if (active) setError("无法读取麦克风列表，请检查浏览器麦克风权限");
      });
    return () => {
      active = false;
    };
  }, []);
  const [captureInfo, setCaptureInfo] = useState<{
    channels: number;
    sampleRate?: number;
    label: string;
  }>();
  const [phase, setPhase] = useState<
    "idle" | "requesting" | "recording" | "decoding" | "ready" | "saving"
  >("idle");
  const [seconds, setSeconds] = useState(0),
    [error, setError] = useState("");
  const [file, setFile] = useState<File>(),
    [url, setUrl] = useState("");
  const [consent, setConsent] = useState(false),
    [listened, setListened] = useState(false);
  const recorder = useRef<MediaRecorder | undefined>(undefined),
    stream = useRef<MediaStream | undefined>(undefined);
  const generation = useRef(0),
    starting = useRef(false),
    timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  function release() {
    if (timer.current) clearInterval(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = undefined;
  }
  useEffect(
    () => () => {
      generation.current++;
      release();
    },
    []
  );
  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const value = URL.createObjectURL(file);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [file]);
  async function start() {
    if (starting.current || recorder.current?.state === "recording") return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("当前浏览器不支持网页录音，请在HTTPS页面的Chrome或Safari中打开");
      return;
    }
    starting.current = true;
    const seq = ++generation.current;
    setPhase("requesting");
    setError("");
    setFile(undefined);
    setConsent(false);
    setListened(false);
    setSeconds(0);
    try {
      if (!deviceId)
        throw new Error(
          "请选择内置麦克风（Built-in Mic），不使用默认或虚拟设备"
        );
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          sampleRate: { ideal: 48000 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      if (generation.current !== seq) {
        mic.getTracks().forEach(track => track.stop());
        return;
      }
      stream.current = mic;
      const track = mic.getAudioTracks()[0],
        settings = track?.getSettings();
      if (
        settings.deviceId !== deviceId ||
        /virtual|filmage|blackhole|loopback/i.test(track.label)
      )
        throw new Error("实际麦克风与所选设备不符，已停止录音");
      setCaptureInfo({
        channels: settings.channelCount || 1,
        sampleRate: settings.sampleRate,
        label: track.label,
      });
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
      ].find(type => MediaRecorder.isTypeSupported(type));
      const capture = new MediaRecorder(mic, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 256000,
      });
      recorder.current = capture;
      const chunks: Blob[] = [];
      capture.ondataavailable = event => {
        if (event.data.size) chunks.push(event.data);
      };
      capture.onerror = () => {
        if (generation.current === seq) {
          generation.current++;
          release();
          setPhase("idle");
          setError("麦克风录音中断，请重新录制");
        }
      };
      capture.onstop = async () => {
        mic.getTracks().forEach(track => track.stop());
        if (timer.current) clearInterval(timer.current);
        if (generation.current !== seq) return;
        setPhase("decoding");
        const audio = new AudioContext({
          sampleRate: settings.sampleRate || 48000,
        });
        try {
          const decoded = await audio.decodeAudioData(
            await new Blob(chunks, { type: capture.mimeType }).arrayBuffer()
          );
          setCaptureInfo({
            channels: decoded.numberOfChannels,
            sampleRate: decoded.sampleRate,
            label: track.label,
          });
          const channels = Array.from(
            { length: decoded.numberOfChannels },
            (_, i) => decoded.getChannelData(i)
          );
          const wav = encodeDigitalHumanWav(channels, decoded.sampleRate);
          if (generation.current !== seq) return;
          setFile(new File([wav], "我的声音.wav", { type: "audio/wav" }));
          setSeconds(decoded.duration);
          setPhase("ready");
        } catch (e) {
          if (generation.current === seq) {
            setError(e instanceof Error ? e.message : "录音无法读取，请重录");
            setPhase("idle");
          }
        } finally {
          await audio.close();
        }
      };
      capture.start();
      setPhase("recording");
      const started = performance.now();
      timer.current = setInterval(() => {
        const elapsed = (performance.now() - started) / 1000;
        setSeconds(elapsed);
        // 预留编码尾帧，确保实际文件不超过原克隆服务的30秒上限。
        if (elapsed >= 29) release();
      }, 100);
    } catch (e) {
      release();
      if (generation.current === seq) {
        setPhase("idle");
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "麦克风未获允许，请在浏览器地址栏的权限设置中允许麦克风后重试"
            : e instanceof DOMException && e.name === "OverconstrainedError"
              ? "所选麦克风当前不可用，请检查设备连接后重新打开录音弹窗。"
              : e instanceof Error
                ? e.message
                : "无法打开麦克风"
        );
      }
    } finally {
      starting.current = false;
    }
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && phase !== "saving") onClose();
      }}
    >
      <DialogContent
        className="dh-recording-dialog"
        onInteractOutside={e => e.preventDefault()}
      >
        <DialogTitle>录下你的声音 · 内置麦克风</DialogTitle>
        <DialogDescription>
          点击“开始录音”后允许麦克风。建议15–20秒，3–30秒有效；录音先留在本页，试听后再决定是否使用。
        </DialogDescription>
        <p>
          使用明确选定的麦克风，保留实际输入声道，不复制为双声道。目标48kHz，实际采样率以保存文件为准。
        </p>
        <label>
          麦克风
          <select
            aria-label="麦克风"
            value={deviceId}
            disabled={!["idle", "ready"].includes(phase)}
            onChange={e => {
              setDeviceId(e.target.value);
              setCaptureInfo(undefined);
              setFile(undefined);
              setListened(false);
              setConsent(false);
              setPhase("idle");
            }}
          >
            <option value="">请选择内置麦克风</option>
            {devices.map(device => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || "未命名麦克风"}
              </option>
            ))}
          </select>
        </label>
        {captureInfo && (
          <p role="status">
            当前设备：{captureInfo.label} · {captureInfo.channels}声道 ·{" "}
            {captureInfo.sampleRate
              ? `${captureInfo.sampleRate}Hz`
              : "采样率待确认"}
          </p>
        )}
        <blockquote>{DIGITAL_HUMAN_RECORDING_READ_TEXT}</blockquote>
        <p role="status" aria-live="polite">
          {phase === "recording"
            ? `正在录音 · ${seconds.toFixed(1)}秒`
            : phase === "requesting"
              ? "请允许浏览器使用麦克风"
              : phase === "decoding"
                ? "正在准备试听…"
                : phase === "saving"
                  ? "正在保存这段声音…"
                  : file
                    ? `已录${seconds.toFixed(1)}秒，请试听`
                    : "准备好后点击下面的按钮"}
        </p>
        {error && <p role="alert">{error}</p>}
        <button
          type="button"
          disabled={disabled || !["idle", "ready"].includes(phase)}
          onClick={() => void start()}
        >
          {file ? "重新录音" : "开始录音"}
        </button>
        {phase === "recording" && (
          <button type="button" onClick={release}>
            停止录音
          </button>
        )}
        {url && (
          <>
            <audio
              controls
              src={url}
              aria-label="试听刚才的录音"
              onEnded={() => setListened(true)}
            />
            <a href={url} download="我的声音.wav">
              保存录音到本机
            </a>
          </>
        )}
        {file && (
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={e => setConsent(e.target.checked)}
            />
            这是我本人的声音，我同意用于建立本人的数字人声线
          </label>
        )}
        <button
          type="button"
          disabled={
            disabled || phase !== "ready" || !file || !consent || !listened
          }
          onClick={async () => {
            if (!file) return;
            setPhase("saving");
            setError("");
            try {
              await onUse(file);
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
              setPhase("ready");
            }
          }}
        >
          使用这段声音
        </button>
        <p>
          先完整试听，再确认使用。关闭弹窗会停止麦克风；尚未使用的录音不会上传。
        </p>
      </DialogContent>
    </Dialog>
  );
}
