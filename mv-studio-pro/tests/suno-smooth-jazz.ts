import axios from "axios";
import * as fs from "fs";

const COMET_API_KEY = process.env.COMET_API_KEY || "sk-UbWOiLztYaxYvgalWtOD04bYVrIV3by4H5e1EU3YUplFS1x8";
const BASE_URL = "https://api.cometapi.com";

async function generateSunoMusic() {
  console.log("=== Smooth Jazz Love BGM — Suno V5 via CometAPI ===\n");

  const style = "Smooth Jazz, Bossa Nova, Romantic, Tenor Saxophone, Rhodes Electric Piano, Upright Bass, Brushed Drums, Acoustic Guitar, String Pad, Slow 54 BPM, Intimate, Late Night, Warm, Dreamy, Elegant, Cinematic";
  const title = "Midnight Whispers";

  console.log("Model: V5 (chirp-v5)");
  console.log("Style:", style);
  console.log("Title:", title);
  console.log("Instrumental: true\n");

  try {
    // Submit via CometAPI Suno endpoint with V5
    const submitResponse = await axios.post(
      `${BASE_URL}/v1/suno/submit/music`,
      {
        prompt: "",
        tags: style,
        mv: "chirp-v5",
        title: title,
        make_instrumental: true,
      },
      {
        headers: {
          Authorization: `Bearer ${COMET_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Submit response:", JSON.stringify(submitResponse.data, null, 2));

    const taskId = submitResponse.data?.data;
    if (!taskId) {
      // Try alternate response format
      const altTaskId = submitResponse.data?.data?.taskId;
      if (!altTaskId) {
        console.error("No task ID returned!");
        return;
      }
    }

    const finalTaskId = submitResponse.data?.data?.taskId || submitResponse.data?.data;
    console.log(`\nTask ID: ${finalTaskId}`);
    console.log("Polling for result (V5 takes ~2-4 minutes)...\n");

    // Poll for results
    for (let i = 1; i <= 80; i++) {
      await new Promise((r) => setTimeout(r, 5000));

      try {
        const statusResponse = await axios.get(
          `${BASE_URL}/v1/suno/fetch/${finalTaskId}`,
          {
            headers: {
              Authorization: `Bearer ${COMET_API_KEY}`,
            },
          }
        );

        const responseData = statusResponse.data?.data;
        const status = responseData?.status;

        if (i % 3 === 0 || status === "complete" || status === "SUCCESS" || status === "FIRST_SUCCESS") {
          console.log(`[${i}/80] Status: ${status}`);
        }

        if (status === "complete" || status === "SUCCESS") {
          console.log("\n✓ Music generated successfully!\n");

          // Try multiple response structures
          const songs = responseData?.data || responseData?.response?.data || [];
          if (Array.isArray(songs) && songs.length > 0) {
            for (let j = 0; j < songs.length; j++) {
              const track = songs[j];
              const audioUrl = track.audio_url || track.stream_audio_url;
              const trackTitle = track.title || `track_${j + 1}`;
              const duration = track.duration;
              const imageUrl = track.image_url;
              const tags = track.tags;

              console.log(`\n── Track ${j + 1}: ${trackTitle} ──`);
              console.log(`Duration: ${duration ? duration + "s" : "unknown"}`);
              console.log(`Tags: ${tags || "N/A"}`);
              if (imageUrl) console.log(`Cover: ${imageUrl}`);
              console.log(`Audio: ${audioUrl}`);

              if (audioUrl) {
                const filename = `/home/ubuntu/suno-smooth-jazz-v5-${j + 1}.mp3`;
                console.log(`\nDownloading to: ${filename}`);
                const audioResponse = await axios.get(audioUrl, {
                  responseType: "arraybuffer",
                  timeout: 60000,
                });
                fs.writeFileSync(filename, Buffer.from(audioResponse.data));
                const sizeMB = (audioResponse.data.byteLength / 1024 / 1024).toFixed(2);
                console.log(`✓ Saved: ${filename} (${sizeMB} MB)`);
              }

              if (imageUrl) {
                const coverFilename = `/home/ubuntu/suno-smooth-jazz-v5-cover-${j + 1}.jpg`;
                try {
                  const imgResponse = await axios.get(imageUrl, {
                    responseType: "arraybuffer",
                    timeout: 30000,
                  });
                  fs.writeFileSync(coverFilename, Buffer.from(imgResponse.data));
                  console.log(`✓ Cover saved: ${coverFilename}`);
                } catch {
                  console.log("(Cover download skipped)");
                }
              }
            }
          } else {
            console.log("Full response:", JSON.stringify(responseData, null, 2).slice(0, 3000));
          }
          return;
        }

        if (status === "failed" || status === "FAILED") {
          console.error("\n✗ Generation failed!");
          console.error("Error:", responseData?.failReason || JSON.stringify(responseData, null, 2).slice(0, 1000));
          return;
        }
      } catch (pollError: any) {
        if (i % 5 === 0) {
          console.error(`[${i}] Poll error:`, pollError.response?.data || pollError.message);
        }
      }
    }

    console.error("\n✗ Timeout after ~7 minutes");
  } catch (error: any) {
    console.error("Submit error:", error.response?.status, error.response?.data || error.message);
  }
}

generateSunoMusic();
