// Test export PDF/Word endpoint directly
import fetch from 'node-fetch';

const API_BASE = 'http://127.0.0.1:3000';

const testStoryboard = {
  title: "测试分镜脚本",
  musicInfo: {
    bpm: 120,
    emotion: "激昂",
    style: "摇滚",
    key: "C大调",
  },
  scenes: [
    {
      sceneNumber: 1,
      timestamp: "00:00-00:10",
      duration: "10秒",
      description: "一个年轻人站在山顶，俯瞰城市全景。",
      cameraMovement: "航拍推镜（Push In），从远景到中景。",
      mood: "壮阔、自由",
      visualElements: ["山顶", "城市全景", "日出"],
      transition: "淡入（Fade In）",
    },
    {
      sceneNumber: 2,
      timestamp: "00:10-00:20",
      duration: "10秒",
      description: "年轻人转身面对镜头，微笑。",
      cameraMovement: "固定镜头（Static），中景。",
      mood: "温暖、希望",
      visualElements: ["人物特写", "阳光"],
    },
  ],
  summary: "整体风格偏向积极向上，适合励志主题。",
};

async function testExport(format) {
  console.log(`\n=== Testing ${format.toUpperCase()} export ===`);
  try {
    // We need to call tRPC mutation endpoint
    const url = `${API_BASE}/api/trpc/storyboard.exportPDF`;
    const body = JSON.stringify({
      json: {
        storyboard: testStoryboard,
        format: format,
      }
    });
    
    console.log('Request URL:', url);
    console.log('Request body:', body.substring(0, 200) + '...');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Need auth cookie - let's check if we can get one
      },
      body: body,
    });
    
    console.log('Response status:', response.status);
    const text = await response.text();
    console.log('Response body:', text.substring(0, 500));
    
    if (response.ok) {
      const data = JSON.parse(text);
      console.log('Parsed result:', JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Test both formats
await testExport('pdf');
await testExport('word');
