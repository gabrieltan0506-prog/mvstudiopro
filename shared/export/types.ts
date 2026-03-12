export interface ExportWatermarkPolicy {
  isPaidUser: boolean;
  imageWatermarkText: string;
  docWatermarkText: string;
}

export interface StoryboardDocExport {
  title: string;
  script?: string;
  scenes: Array<{
    sceneIndex: number;
    sceneTitle?: string;
    scenePrompt?: string;
    character?: string;
    environment?: string;
    action?: string;
    camera?: string;
    mood?: string;
    lighting?: string;
    imageUrls?: string[];
    referenceImages?: string[];
  }>;
}
