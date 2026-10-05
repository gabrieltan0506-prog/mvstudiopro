export interface Media { durationSec:number; audioStreams:unknown[] }
export interface Analysis { summaryZh:string; shots:{startSec:number;endSec:number;descriptionZh:string}[]; audioSegments:{startSec:number;endSec:number;descriptionZh:string}[]; subtitles:{atSec:number;textZh:string}[]; findings:{atSec:number;modality:"visual"|"audio"|"audiovisual";status:"observed"|"interpretation"|"uncertain";issueZh:string;evidenceZh:string;suggestionZh:string}[] }
export function coverage(segments:Analysis['shots'], duration:number):{seconds:number;ratio:number;meaning:string};
export function validateAnalysis(value:Analysis,media:Media):{audioIntervalCoverage:ReturnType<typeof coverage>;visualIntervalCoverage:ReturnType<typeof coverage>;warnings:string[]};
export function responseSchema():unknown;
export function buildRequest(plan:{media:Media;requestedSamplingFps:number;maxOutputTokens:number;context:string},uri:string):{contents:unknown[];generationConfig:Record<string,unknown>};
