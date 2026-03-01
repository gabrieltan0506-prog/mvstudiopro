export async function generateMusic({model, prompt}: {model:string,prompt:string}) {
  const res = await fetch("https://aimusicapi.ai/producer/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + process.env.AIMUSIC_API_KEY
    },
    body: JSON.stringify({ model, prompt })
  });

  return await res.json();
}
