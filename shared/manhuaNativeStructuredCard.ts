/** 整形消费产物为私有永久证据；路径不含签名或凭证。 */
export const NATIVE_STRUCTURED_CARD_PREFIX =
  "manhua-template-learn/structured-card/";
export function isNativeStructuredCardObjectName(
  value: unknown
): value is string {
  return (
    typeof value === "string" &&
    /^manhua-template-learn\/structured-card\/[a-f0-9]{64}\.json$/.test(value)
  );
}
