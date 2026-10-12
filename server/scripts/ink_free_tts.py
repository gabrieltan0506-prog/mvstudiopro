"""映客免费中文对白：固定开源模型、固定男女声，无网络及付费后备。"""
import argparse
import json
import sys
import wave
from pathlib import Path


def load_model(directory):
    import sherpa_onnx
    directory = Path(directory)
    model = directory / "model.int8.onnx"
    if not model.is_file():
        raise ValueError("免费配音模型尚未安装，未生成无声替代品")
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=str(model), voices=str(directory / "voices.bin"),
                tokens=str(directory / "tokens.txt"),
                data_dir=str(directory / "espeak-ng-data"),
                dict_dir=str(directory / "dict"),
                lexicon=",".join(str(directory / name) for name in ("lexicon-us-en.txt", "lexicon-zh.txt")),
            ), num_threads=2, debug=False, provider="cpu",
        ), max_num_sentences=1,
    )
    if not config.validate():
        raise ValueError("免费配音模型配置校验失败")
    return sherpa_onnx.OfflineTts(config)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--output")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    tts = load_model(args.model_dir)
    if tts.sample_rate != 24000 or tts.num_speakers != 103:
        raise ValueError("免费配音模型版本或音色数量不匹配")
    if args.check:
        print(json.dumps({"ready": True, "sampleRate": tts.sample_rate, "speakers": tts.num_speakers}))
        return
    if not args.output:
        raise ValueError("缺少输出路径")
    import numpy as np
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536:
        raise ValueError("配音输入过大")
    value = json.loads(raw)
    duration = float(value["duration"])
    lines = value["speech"]["lines"]
    if not 1 <= duration <= 60 or not 1 <= len(lines) <= 20:
        raise ValueError("配音时长或句数无效")
    if sum(len(line["text"]) for line in lines) > 300:
        raise ValueError("免费配音合计超过300字")
    sample_rate = tts.sample_rate
    mixed = np.zeros(round(duration * sample_rate), dtype=np.float32)
    receipts = []
    previous_end = 0.0
    for index, line in enumerate(sorted(lines, key=lambda item: item["at"])):
        at, window = float(line["at"]), float(line["duration"])
        text = line["text"].strip()
        if at < previous_end or window <= 0 or at + window > duration + 1e-6 or not text:
            raise ValueError("对白秒窗无效或重叠")
        previous_end = at + window
        sid = {"female": 3, "male": 58}[line["voice"]]
        audio = tts.generate(text, sid=sid, speed=1.0)
        samples = np.asarray(audio.samples, dtype=np.float32)
        measured = len(samples) / sample_rate
        if measured <= 0 or not np.isfinite(samples).all() or float(np.max(np.abs(samples))) < 0.0001:
            raise ValueError(f"第{index + 1}句配音为空或不可用")
        if measured > window:
            raise ValueError(f"第{index + 1}句需要{measured:.2f}秒，超过{window:.2f}秒窗口；请缩短台词或增加镜头时长")
        start = round(at * sample_rate)
        mixed[start:start + len(samples)] += samples
        receipts.append({"index": index, "at": at, "duration": measured, "voice": line["voice"]})
    peak = float(np.max(np.abs(mixed)))
    if peak > 0.95:
        mixed *= 0.95 / peak
    with wave.open(args.output, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes((mixed * 32767).astype("<i2").tobytes())
    print(json.dumps({"engine": "kokoro-zh-v1.1", "duration": duration, "sampleRate": sample_rate, "lines": receipts}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
