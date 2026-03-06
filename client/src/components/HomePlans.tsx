import React from "react";

export default function HomePlans() {
  return (
    <section className="max-w-[1240px] mx-auto px-5 pt-12">
      <div className="rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.03))] p-6 md:p-10">
        <h2 className="text-4xl font-bold mb-4 text-white">
          套餐方案
          <span className="text-purple-400 text-lg ml-2">Plans</span>
        </h2>

        <p className="text-gray-400 mb-12">
          所有生成均使用积分系统。免费用户每天可试用部分功能。
        </p>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="bg-[#12121a] rounded-2xl p-8 border border-purple-700/20">
            <h3 className="text-2xl text-white mb-4">教育专案</h3>
            <p className="text-gray-400 mb-6">Education Plan</p>

            <div className="text-4xl text-purple-400 mb-6">¥49</div>

            <ul className="text-gray-300 space-y-3 mb-8">
              <li>Kling 2.6 生成</li>
              <li>Suno 音乐</li>
              <li>基础工作流</li>
              <li>100 积分</li>
            </ul>

            <button className="px-6 py-3 rounded-lg bg-purple-600 hover:bg-purple-700 text-white">
              立即购买
            </button>
          </div>

          <div className="bg-[#151520] rounded-2xl p-8 border border-pink-600/30 scale-105">
            <h3 className="text-2xl text-white mb-4">商业套餐</h3>
            <p className="text-gray-400 mb-6">Business Plan</p>

            <div className="text-4xl text-pink-400 mb-6">¥249</div>

            <ul className="text-gray-300 space-y-3 mb-8">
              <li>Kling 3.0 视频</li>
              <li>Nano Banana Pro</li>
              <li>自动音乐匹配</li>
              <li>500 积分</li>
            </ul>

            <button className="px-6 py-3 rounded-lg bg-pink-600 hover:bg-pink-700 text-white">
              立即购买
            </button>
          </div>

          <div className="bg-[#12121a] rounded-2xl p-8 border border-yellow-600/20">
            <h3 className="text-2xl text-white mb-4">导演套餐</h3>
            <p className="text-gray-400 mb-6">Director Plan</p>

            <div className="text-4xl text-yellow-400 mb-6">¥999</div>

            <ul className="text-gray-300 space-y-3 mb-8">
              <li>Veo 3.1 Pro</li>
              <li>高级工作流</li>
              <li>爆款分析师</li>
              <li>1000 积分</li>
            </ul>

            <button className="px-6 py-3 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
              立即购买
            </button>
          </div>
        </div>

        <div className="mt-12 text-gray-500 text-sm">
          免费用户每天可体验部分功能，生成内容将带水印。
        </div>
      </div>
    </section>
  );
}
