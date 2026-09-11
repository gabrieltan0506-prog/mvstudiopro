/**
 * 全局 sharp/libvips 约束（0911 用户拍板，OOM 事故后）：
 * 默认配置下 libvips 开操作缓存 + 每操作多线程，处理 4K 大图时内存无上界，
 * 23 页知识卡导出把进程推到 7.7 GB 被 OOM 杀掉。全站统一：关缓存、单线程。
 * 注意语义：sharp.concurrency 限制的是**单次操作内部**的线程数，请求之间照常并发，
 * 所以这不是进程内存的硬上界，只是把单次大图操作的峰值压下来、并关掉缓存驻留。
 * 需要调优时用 SHARP_CONCURRENCY 环境变量，不改代码。
 */
import sharp from "sharp";

sharp.cache(false);
const conc = Number(process.env.SHARP_CONCURRENCY);
sharp.concurrency(Number.isInteger(conc) && conc >= 1 && conc <= 8 ? conc : 1);
