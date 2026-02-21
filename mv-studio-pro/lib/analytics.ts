import { Platform } from "react-native";

const GA_MEASUREMENT_ID = "G-XW7BG9X2QB";

/**
 * Google Analytics 4 integration for web platform.
 * Injects the gtag.js script and provides tracking utilities.
 */

/** Check if GA is already initialized */
let isInitialized = false;

/**
 * Initialize Google Analytics 4 by injecting the gtag.js script.
 * Only runs on web platform. Safe to call multiple times.
 */
export function initGA4(): void {
  if (Platform.OS !== "web" || isInitialized) return;
  if (typeof document === "undefined") return;

  // Prevent duplicate initialization
  if (document.querySelector(`script[src*="googletagmanager.com/gtag"]`)) {
    isInitialized = true;
    return;
  }

  // Inject gtag.js script
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  // Initialize gtag dataLayer
  const inlineScript = document.createElement("script");
  inlineScript.textContent = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${GA_MEASUREMENT_ID}', {
      send_page_view: false
    });
  `;
  document.head.appendChild(inlineScript);

  isInitialized = true;
}

/**
 * Track a page view event in GA4.
 * @param path - The page path (e.g., "/analyze", "/publish")
 * @param title - The page title
 */
export function trackPageView(path: string, title?: string): void {
  if (Platform.OS !== "web" || !isInitialized) return;
  if (typeof window === "undefined") return;

  const w = window as any;
  if (typeof w.gtag === "function") {
    w.gtag("event", "page_view", {
      page_path: path,
      page_title: title || document.title,
      page_location: window.location.href,
    });
  }
}

/**
 * Track a custom event in GA4.
 * @param eventName - The event name (e.g., "click_feature", "submit_form")
 * @param params - Additional event parameters
 */
export function trackEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>
): void {
  if (Platform.OS !== "web" || !isInitialized) return;
  if (typeof window === "undefined") return;

  const w = window as any;
  if (typeof w.gtag === "function") {
    w.gtag("event", eventName, params);
  }
}

/**
 * Track guestbook form submission
 */
export function trackFormSubmission(formName: string): void {
  trackEvent("form_submission", {
    form_name: formName,
  });
}

/**
 * Track feature card click
 */
export function trackFeatureClick(featureName: string): void {
  trackEvent("feature_click", {
    feature_name: featureName,
  });
}
