import { ArrowLeftRight } from "lucide-react";

export default function MVCompare() {
  return (
    <div className="min-h-screen bg-[#0A0A0C] flex flex-col items-center justify-center p-8">
      <div className="flex flex-col items-center">
        <div className="w-20 h-20 rounded-2xl bg-[rgba(232,130,94,0.12)] flex items-center justify-center mb-6">
          <ArrowLeftRight size={48} color="#E8825E" />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-[#F7F4EF] tracking-tighter mb-2 text-center">
          MV 版本对比
        </h1>
        <p className="text-base font-semibold text-[#E8825E] mb-4">即将推出</p>
        <p className="text-sm text-[#9B9691] text-center leading-6 mb-8 max-w-sm">
          逐帧对比不同版本视频，精准定位画面差异与优化空间。
        </p>
        <button
          className="px-6 py-3 rounded-full border border-white/25 transition-colors hover:bg-white/5"
          onClick={() => window.history.back()}
        >
          <span className="text-sm font-medium text-[#F7F4EF]">← 返回首页</span>
        </button>
      </div>
    </div>
  );
}
