import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export function HomeEnterpriseAgentCard() {
  return (
    <div className="rounded-2xl bg-white border-2 border-[#C9A858]/40 p-6 md:p-8 shadow-xl">
      <div className="flex items-center gap-2 mb-3">
        <span className="px-2 py-0.5 bg-[#1F3A5F] text-[#C9A858] text-[10px] font-bold rounded uppercase tracking-widest">
          Enterprise · 企業專屬
        </span>
        <span className="px-2 py-0.5 bg-[#FB7185]/10 text-[#FB7185] text-[10px] font-bold rounded">
          ¥15,000 起 · 30 天试用
        </span>
      </div>
      <h3 className="text-2xl md:text-3xl font-black text-[#0F1B2D] mb-2">
        企业专属智能体定制
      </h3>
      <p className="text-sm md:text-base text-[#55657A] leading-relaxed mb-5">
        把您的销冠 SOP、客诉手册、战败分析喂给一个永远在线的战略大脑。
        30 天 ¥15,000 试用，不满意不升级正式版。
      </p>
      <ul className="space-y-2 mb-6 text-sm text-[#0F1B2D]">
        <li>✓ 私有化知识库 (PDF / TXT 上传，企业隔离存储)</li>
        <li>✓ Gemini 3.1 Pro 顶配算力推演</li>
        <li>✓ 30 天 / 100 次调用 / 50 MB 知识库</li>
        <li>✓ 满意可抵扣 50% Pro 部署费</li>
      </ul>
      <Link href="/enterprise-agent">
        <Button className="w-full bg-gradient-to-r from-[#1F3A5F] to-[#2D4A6F] text-[#C9A858] font-black text-base py-6 rounded-xl hover:opacity-90 transition-opacity">
          开始 30 天试用 →
        </Button>
      </Link>
    </div>
  );
}
