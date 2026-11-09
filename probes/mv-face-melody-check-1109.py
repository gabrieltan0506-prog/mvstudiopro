# 镜头自带声抽查：逐 1 秒统计「有稳定音高的帧」占比（谐波性 = 归一化自相关峰值 >0.6，基频 80–1000 Hz）与响度。
# 雨声/车流等宽带噪声谐波性低；音乐/人声旋律谐波性高。仅本地分析，不调用任何模型。
import sys, subprocess, json, numpy as np
f = sys.argv[1]; sr = 16000
raw = subprocess.run(["ffmpeg","-v","error","-i",f,"-map","0:a:0","-ac","1","-ar",str(sr),"-f","f32le","-"],capture_output=True,check=True).stdout
x = np.frombuffer(raw, dtype=np.float32)
fr = int(0.04*sr); hop = int(0.02*sr)
out = []
for s in range(0, int(len(x)/sr)):
    seg = x[s*sr:(s+1)*sr]
    rms = float(np.sqrt(np.mean(seg**2))+1e-12)
    voiced = 0; n = 0
    for i in range(0, len(seg)-fr, hop):
        w = seg[i:i+fr]*np.hanning(fr); n += 1
        if np.sqrt(np.mean(w**2)) < 0.005: continue
        ac = np.correlate(w, w, "full")[fr-1:]; ac = ac/(ac[0]+1e-12)
        lo, hi = sr//1000, sr//80
        if ac[lo:hi].max() > 0.6: voiced += 1
    out.append({"sec": s, "db": round(20*np.log10(rms),1), "tonal": round(voiced/max(n,1),2)})
print(json.dumps(out))
