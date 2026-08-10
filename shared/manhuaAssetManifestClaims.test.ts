import { describe, expect, it } from "vitest";
import {
  buildManhuaAssetManifestClaims,
  resolveManhuaAssetManifestClaim,
} from "./manhuaAssetManifestClaims";

describe("manhuaAssetManifestClaims", () => {
  it("人物按 id 认领，同一张道具拼板保留多个名字", () => {
    const claims = buildManhuaAssetManifestClaims({
      characters: [
        {
          id: "wa_char_ajiu",
          nameZh: "阿咎",
          images: {
            half: "assets/characters/阿咎_半身.png",
            full: "assets/characters/阿咎_全身.png",
          },
        },
      ],
      props: [
        { nameZh: "残玉", sheet: "assets/props/道具设定01.png" },
        { nameZh: "修复锥", sheet: "assets/props/道具设定01.png" },
      ],
    });
    expect(
      resolveManhuaAssetManifestClaim(
        claims,
        "雁门照山河_前六集资产包/assets/characters/阿咎_半身.png"
      )
    ).toEqual({ anchorIds: ["wa_char_ajiu"], anchorNamesZh: ["阿咎"] });
    expect(
      resolveManhuaAssetManifestClaim(claims, "assets/props/道具设定01.png")
    ).toEqual({
      anchorIds: [],
      anchorNamesZh: ["残玉", "修复锥"],
    });
  });
});
