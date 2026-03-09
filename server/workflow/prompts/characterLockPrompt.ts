export function buildCharacterLockPrompt(input: {
  gender?: string;
  age?: string;
  appearance?: string;
  outfit?: string;
  hair?: string;
  optionalReferenceImage?: string;
}) {
  const gender = String(input.gender || "").trim() || "unspecified";
  const age = String(input.age || "").trim() || "unspecified";
  const appearance = String(input.appearance || "").trim() || "unspecified";
  const outfit = String(input.outfit || "").trim() || "unspecified";
  const hair = String(input.hair || "").trim() || "unspecified";
  const ref = String(input.optionalReferenceImage || "").trim();

  const base = [
    "Character Lock Profile:",
    `gender: ${gender}`,
    `age: ${age}`,
    `appearance: ${appearance}`,
    `outfit: ${outfit}`,
    `hair: ${hair}`,
    "Do not change: facial structure, hairstyle, clothing, age, gender.",
  ];
  if (ref) base.push(`reference image: ${ref}`);
  return base.join(" ");
}
