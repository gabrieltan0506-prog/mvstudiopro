import { expect, it } from "vitest";
import {canWavespeedUpscale,wavespeedSourceResolutionFromDimensions,wavespeedUpscaleTargetsForSource} from "./wavespeedVideoUpscaleModels";
it("480p最高2K，720p/768p可2K或4K，未知和已达2K不猜测升级",()=>{
 expect(wavespeedUpscaleTargetsForSource("480p")).toEqual(["1080p","2k"]);expect(canWavespeedUpscale("480p","4k")).toBe(false);
 for(const source of ["720p","768p","1080p"]){expect(canWavespeedUpscale(source,"2k")).toBe(true);expect(canWavespeedUpscale(source,"4k")).toBe(true);}
 for(const source of [undefined,"","unknown","2k","4k"]){expect(canWavespeedUpscale(source,"4k")).toBe(false);}
 expect(wavespeedSourceResolutionFromDimensions(0,720)).toBeNull();expect(wavespeedSourceResolutionFromDimensions(480,854)).toBe("480p");expect(wavespeedSourceResolutionFromDimensions(1280,720)).toBe("720p");
});
