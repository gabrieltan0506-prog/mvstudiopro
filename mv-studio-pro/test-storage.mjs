// Direct test of storagePut + storageGet to verify export pipeline
import 'dotenv/config';

const FORGE_API_URL = process.env.BUILT_IN_FORGE_API_URL;
const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY;

if (!FORGE_API_URL || !FORGE_API_KEY) {
  console.error('Missing BUILT_IN_FORGE_API_URL or BUILT_IN_FORGE_API_KEY');
  process.exit(1);
}

const baseUrl = FORGE_API_URL.replace(/\/+$/, '') + '/';

async function testStoragePipeline() {
  console.log('=== Testing Storage Pipeline ===');
  console.log('Base URL:', baseUrl);
  
  // 1. Upload a test file
  const testContent = '<html><body><h1>Test Export</h1><p>测试导出功能</p></body></html>';
  const fileName = `test_export_${Date.now()}.doc`;
  
  console.log('\n1. Uploading test file:', fileName);
  const uploadUrl = new URL('v1/storage/upload', baseUrl);
  uploadUrl.searchParams.set('path', fileName);
  
  const blob = new Blob([testContent], { type: 'application/msword' });
  const form = new FormData();
  form.append('file', blob, fileName);
  
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${FORGE_API_KEY}` },
    body: form,
  });
  
  console.log('Upload status:', uploadRes.status, uploadRes.statusText);
  const uploadJson = await uploadRes.json();
  console.log('Upload response:', JSON.stringify(uploadJson, null, 2));
  
  if (!uploadRes.ok) {
    console.error('Upload failed!');
    return;
  }
  
  // 2. Get download URL
  console.log('\n2. Getting download URL for:', fileName);
  const downloadApiUrl = new URL('v1/storage/downloadUrl', baseUrl);
  downloadApiUrl.searchParams.set('path', fileName);
  
  const downloadRes = await fetch(downloadApiUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${FORGE_API_KEY}` },
  });
  
  console.log('Download URL status:', downloadRes.status, downloadRes.statusText);
  const downloadJson = await downloadRes.json();
  console.log('Download URL response:', JSON.stringify(downloadJson, null, 2));
  
  if (downloadJson.url) {
    console.log('\n3. Testing download URL accessibility...');
    const testDownload = await fetch(downloadJson.url, { method: 'HEAD' });
    console.log('Download URL accessible:', testDownload.status, testDownload.statusText);
    console.log('Content-Type:', testDownload.headers.get('content-type'));
    console.log('Content-Length:', testDownload.headers.get('content-length'));
    console.log('\n✅ Download URL:', downloadJson.url);
  }
}

testStoragePipeline().catch(console.error);
