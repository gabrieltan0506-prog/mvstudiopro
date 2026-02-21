import Head from "expo-router/head";
import { Platform } from "react-native";

const SITE_NAME = "MV Studio Pro";
const SITE_URL = "https://mvstudiopro.com";
const LOGO_URL =
  "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/FlXkerfdYuPKPPqg.png";

/**
 * JSON-LD structured data for the website.
 * Adds WebSite, Organization, and SoftwareApplication schema.
 */
export function SEOJsonLd() {
  if (Platform.OS !== "web") return null;

  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    description: "AI 驱动的一站式视频创作平台",
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };

  const orgSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: LOGO_URL,
    sameAs: [],
  };

  const appSchema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web, iOS, Android",
    description: "AI 驱动的一站式视频创作平台 — 视频PK评分、虚拟偶像批量制作、视觉特效、多平台发布策略一站式解决方案",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    featureList: [
      "AI视频PK评分",
      "虚拟偶像批量生成",
      "视觉特效滤镜",
      "多平台发布策略",
      "精华视频展厅",
      "视频对比工具",
      "片段拼接工坊",
    ],
  };

  return (
    <Head>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(appSchema) }}
      />
    </Head>
  );
}
