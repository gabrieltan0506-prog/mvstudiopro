import { Helmet } from 'react-helmet-async';
// Helmet removed - using document.title instead

export interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogUrl?: string;
  ogType?: string;
  twitterCard?: "summary" | "summary_large_image";
  canonicalUrl?: string;
  noIndex?: boolean;
}

const SITE_NAME = "MV Studio Pro";
const DEFAULT_DESCRIPTION =
  "AI 驱动的一站式视频创作平台 — 视频PK评分、虚拟偶像批量制作、视觉特效、多平台发布策略一站式解决方案";
const DEFAULT_KEYWORDS =
  "视频制作,音乐视频,AI视频,虚拟偶像,视觉特效,视频PK评分,发布策略,抖音,B站,小红书,视频号,短视频,MV Studio Pro";
const DEFAULT_OG_IMAGE =
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/FlXkerfdYuPKPPqg.png";
const SITE_URL = "https://mvstudiopro.com";

/**
 * SEO Head component for adding meta tags, Open Graph, and Twitter Card tags.
 *
 * Usage:
 * ```tsx
 * <SEOHead
 *   title="视频 PK 评分"
 *   description="AI 智能分析您的视频，提供专业优化建议"
 *   ogUrl="https://mvstudiopro.com/analyze"
 * />
 * ```
 */
export function SEOHead({
  title,
  description = DEFAULT_DESCRIPTION,
  keywords = DEFAULT_KEYWORDS,
  ogTitle,
  ogDescription,
  ogImage = DEFAULT_OG_IMAGE,
  ogUrl,
  ogType = "website",
  twitterCard = "summary_large_image",
  canonicalUrl,
  noIndex = false,
}: SEOProps) {

  const fullTitle = title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} — My Video, I am the team.`;
  const finalOgTitle = ogTitle || fullTitle;
  const finalOgDescription = ogDescription || description;
  const finalCanonical = canonicalUrl || ogUrl || SITE_URL;

  return (
    <Helmet>
      {/* Primary Meta Tags */}
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords} />
      <meta name="author" content="MV Studio Pro" />
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
      <meta name="theme-color" content="#101012" />
      <meta name="application-name" content={SITE_NAME} />

      {/* Robots */}
      {noIndex ? (
        <meta name="robots" content="noindex, nofollow" />
      ) : (
        <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
      )}

      {/* Canonical URL */}
      <link rel="canonical" href={finalCanonical} />

      {/* Open Graph / Facebook */}
      <meta property="og:type" content={ogType} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={finalOgTitle} />
      <meta property="og:description" content={finalOgDescription} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:url" content={finalCanonical} />
      <meta property="og:locale" content="zh_TW" />

      {/* Twitter Card */}
      <meta name="twitter:card" content={twitterCard} />
      <meta name="twitter:title" content={finalOgTitle} />
      <meta name="twitter:description" content={finalOgDescription} />
      <meta name="twitter:image" content={ogImage} />

      {/* Performance: DNS Prefetch & Preconnect */}
      <link rel="dns-prefetch" href="https://files.manuscdn.com" />
      <link rel="preconnect" href="https://files.manuscdn.com" crossOrigin="anonymous" />

      {/* Apple Mobile Web App */}
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="apple-mobile-web-app-title" content={SITE_NAME} />

      {/* Google Search Console Verification */}
      <meta name="google-site-verification" content="V51QRHwNHkqY5hYUBTz_u3Goet6upUW7uX7O-n2eyPo" />

      {/* Microsoft */}
      <meta name="msapplication-TileColor" content="#E8825E" />
    </Helmet>
  );
}
