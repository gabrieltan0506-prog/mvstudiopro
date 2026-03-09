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

  const lines = [
    "Character Lock Profile",
    `gender: ${gender}`,
    `age: ${age}`,
    `appearance: ${appearance}`,
    `outfit: ${outfit}`,
    `hair: ${hair}`,
    "Hard constraints for all following generations:",
    "- keep facial structure unchanged",
    "- keep hairstyle unchanged",
    "- keep outfit unchanged",
    "- keep age unchanged",
    "- keep gender unchanged",
    "- no identity drift across scenes",
  ];

  if (ref) lines.push(`reference image: ${ref}`);
  return lines.join("\n");
}
