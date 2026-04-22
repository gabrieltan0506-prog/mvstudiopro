export async function generateMusicWithSuno(input: { script: string }) {
  const script = String(input.script || "").trim();
  const key = String(process.env.AIMUSIC_API_KEY || process.env.AIMUSICAPI_KEY || "").trim();
  const base = String(process.env.AIMUSIC_BASE_URL || "https://api.aimusicapi.ai").replace(/\/+$/, "");

  if (!script) {
    return {
      musicUrl: "",
      provider: "suno",
      model: "suno",
      isFallback: true,
      errorMessage: "script is required",
    };
  }

  if (!key) {
    return {
      musicUrl: "",
      provider: "suno",
      model: "suno",
      isFallback: true,
      errorMessage: "AIMUSIC_API_KEY is not configured",
    };
  }

  try {
    const createRes = await fetch(`${base}/api/v1/sonic/create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        task_type: "create_music",
        custom_mode: false,
        mv: "sonic-v5-5",
        gpt_description_prompt: `根据以下视频脚本生成32秒纯音乐BGM：${script.slice(0, 1200)}`,
      }),
    });

    const createJson: any = await createRes.json().catch(() => ({}));
    const taskId = String(createJson?.data?.task_id || createJson?.task_id || "").trim();
    if (!taskId) {
      return {
        musicUrl: "",
        provider: "suno",
        model: "suno",
        isFallback: true,
        errorMessage: "suno task_id missing",
      };
    }

    for (let i = 0; i < 24; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const pollRes = await fetch(`${base}/api/v1/sonic/task/${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      });
      const pollJson: any = await pollRes.json().catch(() => ({}));
      const clips = Array.isArray(pollJson?.data) ? pollJson.data : [];
      const done = clips.find((c: any) => String(c?.state || "").toLowerCase() === "succeeded" && c?.audio_url);
      if (done?.audio_url) {
        return {
          musicUrl: String(done.audio_url),
          provider: "suno",
          model: "suno",
          isFallback: false,
          errorMessage: "",
        };
      }
    }

    return {
      musicUrl: "",
      provider: "suno",
      model: "suno",
      isFallback: true,
      errorMessage: "suno generation timeout",
    };
  } catch (error: any) {
    return {
      musicUrl: "",
      provider: "suno",
      model: "suno",
      isFallback: true,
      errorMessage: error?.message || String(error),
    };
  }
}
