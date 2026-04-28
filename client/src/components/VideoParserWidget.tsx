import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Download, Loader2, Zap, AlertCircle, CheckCircle } from 'lucide-react';

interface ParseResult {
  title: string;
  downloadUrl: string;
  coverUrl: string;
  platform: string;
  duration: number;
  uploader: string;
  description: string;
}

function formatDuration(seconds: number): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function VideoParserWidget() {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState('');

  const parseMut = trpc.videoParser.parse.useMutation({
    onSuccess: (data) => {
      setResult(data as ParseResult);
      setError('');
    },
    onError: (err) => {
      setError(err.message);
      setResult(null);
    },
  });

  const handleParse = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setResult(null);
    setError('');
    // YouTube 在数据中心 IP 上被官方反爬完全封锁（连用户 cookie 也会被主动失效），
    // 前端直接拦截，给清晰提示，避免用户等十几秒后才看到失败。
    if (/youtube\.com|youtu\.be/i.test(trimmed)) {
      setError(
        'YouTube 暂不支持：YouTube 已对所有云服务器 IP（含我们）施加严格反爬，cookie 也无法绕过。请改用 B 站 / 抖音 / 快手 / 小红书 链接 —— 这些平台均正常工作。',
      );
      return;
    }
    parseMut.mutate({ url: trimmed });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleParse();
  };

  const isLoading = parseMut.isPending;

  const PLATFORMS = ['YouTube', '抖音', '快手', '小红书', 'B站'];

  return (
    <div
      style={{
        background: '#0a0700',
        border: '1px solid rgba(200,160,0,0.30)',
        borderRadius: 16,
        padding: '20px 24px',
        boxShadow: '0 0 24px rgba(200,160,0,0.08)',
      }}
    >
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Zap size={18} color="#c8a000" />
        <span style={{ color: '#c8a000', fontWeight: 700, fontSize: 15, letterSpacing: '0.06em' }}>
          万能素材解析引擎
        </span>
        <div style={{ display: 'flex', gap: 6, marginLeft: 6, flexWrap: 'wrap' }}>
          {PLATFORMS.map((p) => (
            <span
              key={p}
              style={{
                fontSize: 11,
                color: '#a07800',
                background: 'rgba(200,160,0,0.12)',
                border: '1px solid rgba(200,160,0,0.25)',
                borderRadius: 4,
                padding: '1px 7px',
                letterSpacing: '0.04em',
              }}
            >
              {p}
            </span>
          ))}
        </div>
      </div>

      {/* 输入行 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="粘贴视频链接（YouTube / 抖音 / 快手 / 小红书 / B站…）"
          disabled={isLoading}
          style={{
            flex: 1,
            background: '#100d00',
            border: '1px solid rgba(200,160,0,0.28)',
            borderRadius: 8,
            color: '#e8d080',
            fontSize: 13,
            padding: '9px 14px',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={handleParse}
          disabled={isLoading || !url.trim()}
          style={{
            background: isLoading ? 'rgba(200,160,0,0.15)' : 'rgba(200,160,0,0.22)',
            border: '1px solid rgba(200,160,0,0.45)',
            borderRadius: 8,
            color: '#c8a000',
            fontWeight: 700,
            fontSize: 13,
            padding: '9px 18px',
            cursor: isLoading || !url.trim() ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            whiteSpace: 'nowrap',
            transition: 'background 0.2s',
          }}
        >
          {isLoading ? (
            <>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              ⚙️ 本地硬解中...
            </>
          ) : (
            <>
              <Zap size={14} />
              静默萃取
            </>
          )}
        </button>
      </div>

      {/* 解析成功 */}
      {result && (
        <div
          style={{
            background: 'rgba(200,160,0,0.06)',
            border: '1px solid rgba(200,160,0,0.22)',
            borderRadius: 10,
            padding: '14px 16px',
            display: 'flex',
            gap: 14,
            alignItems: 'flex-start',
          }}
        >
          {result.coverUrl && (
            <img
              src={result.coverUrl}
              alt="封面"
              style={{
                width: 80,
                height: 60,
                objectFit: 'cover',
                borderRadius: 6,
                border: '1px solid rgba(200,160,0,0.25)',
                flexShrink: 0,
              }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                color: '#e8d080',
                fontWeight: 600,
                fontSize: 14,
                marginBottom: 6,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={result.title}
            >
              {result.title}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
              {result.platform && (
                <span style={{ fontSize: 11, color: '#a07800' }}>
                  平台：{result.platform}
                </span>
              )}
              {result.duration > 0 && (
                <span style={{ fontSize: 11, color: '#a07800' }}>
                  时长：{formatDuration(result.duration)}
                </span>
              )}
              {result.uploader && (
                <span style={{ fontSize: 11, color: '#a07800' }}>
                  作者：{result.uploader}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <a
                href={result.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: 'rgba(200,160,0,0.18)',
                  border: '1px solid rgba(200,160,0,0.40)',
                  borderRadius: 6,
                  color: '#c8a000',
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '5px 12px',
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
              >
                <Download size={12} />
                ↓ 下载 MP4
              </a>
              <button
                onClick={() => {
                  const input = document.querySelector<HTMLInputElement>(
                    'input[placeholder*="视频"]',
                  );
                  if (input) {
                    const nativeSetter = Object.getOwnPropertyDescriptor(
                      window.HTMLInputElement.prototype,
                      'value',
                    )?.set;
                    nativeSetter?.call(input, result.downloadUrl);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                  }
                  navigator.clipboard
                    .writeText(result.downloadUrl)
                    .catch(() => {});
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 6,
                  color: '#ccc',
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '5px 12px',
                  cursor: 'pointer',
                }}
              >
                ✂️ 复制到创作区
              </button>
            </div>
          </div>
          <CheckCircle size={16} color="#4ade80" style={{ flexShrink: 0, marginTop: 2 }} />
        </div>
      )}

      {/* 解析失败 */}
      {error && (
        <div
          style={{
            background: 'rgba(255,60,60,0.07)',
            border: '1px solid rgba(255,60,60,0.25)',
            borderRadius: 10,
            padding: '12px 16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <AlertCircle size={14} color="#f87171" />
            <span style={{ color: '#f87171', fontSize: 13, fontWeight: 600 }}>解析失败</span>
          </div>
          <p style={{ color: '#f87171', fontSize: 12, margin: 0, lineHeight: 1.6 }}>{error}</p>
          <p style={{ color: '#a06060', fontSize: 11, margin: '8px 0 0', lineHeight: 1.5 }}>
            引擎将在后台自动更新，请稍候后重试。
          </p>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
