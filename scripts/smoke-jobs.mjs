const baseUrl = process.env.SMOKE_TEST_BASE_URL;

if (!baseUrl) {
  console.log("SMOKE_TEST_BASE_URL not set; skipping job queue smoke test.");
  process.exit(0);
}

const normalizedBase = baseUrl.replace(/\/$/, "");
const endpoint = `${normalizedBase}/api/jobs`;

async function run() {
  const createResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "image",
      input: { prompt: "test" },
    }),
  });

  if (!createResponse.ok) {
    const body = await createResponse.text();
    throw new Error(`POST /api/jobs failed (${createResponse.status}): ${body}`);
  }

  const createJson = await createResponse.json();
  if (!createJson?.jobId || !createJson?.status) {
    throw new Error(`POST /api/jobs missing jobId/status: ${JSON.stringify(createJson)}`);
  }

  const jobId = createJson.jobId;
  const statusResponse = await fetch(`${endpoint}/${jobId}`);
  if (!statusResponse.ok) {
    const body = await statusResponse.text();
    throw new Error(`GET /api/jobs/${jobId} failed (${statusResponse.status}): ${body}`);
  }

  const statusJson = await statusResponse.json();
  if (!statusJson?.status) {
    throw new Error(`GET /api/jobs/${jobId} missing status: ${JSON.stringify(statusJson)}`);
  }

  console.log("Job queue smoke test passed.");
}

run().catch(error => {
  console.error("Job queue smoke test failed:", error);
  process.exit(1);
});
