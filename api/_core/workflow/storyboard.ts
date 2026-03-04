export function generateStoryboard(text: string) {

  const shots = Array.from({ length: 6 }).map((_, i) => {

    return {
      id: "shot_" + (i + 1),
      title: "镜头 " + (i + 1),
      prompt: text + " cinematic shot " + (i + 1),
      imageUrl: null,
      videoUrl: null,
      status: "queued"
    };

  });

  return {
    shots
  };

}
