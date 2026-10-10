# 程序三維點雲形變與相機環繞

基線 HEAD `bf42ff4e6ee8a462c86b1e1dc9081288bdf57691`。本代理未commit/push/merge/deploy，未啟Fly，沒有模型/媒體生成。

## 可用最小切片

共享 `codeMotionComposition` schema 和預覽/匯出共用 `composition.js` 新增 `type:pointMorph`，`from/to=sphere|torus|helix`，固定seed，最多300點/元素，計入既有單鏡1500總點數。每點具有真實XYZ位置與固定身份，等點數目標按 `transform/keyframes.morph` 0..1線性插值（關鍵幀原ease仍生效），支持原rotationX/Y、scale、layer/blend。近裁面與透視沿原projector，點在同元素內按深度由遠至近繪製。

相機新增 `orbitX/orbitY`（可keyframe），繞camera.x/y對應的z=0目標旋轉；camera.z為距離。先在目標中心轉座標，再施加相機距離和既有朝向。舊相機rotation行為不更改；未填orbit等於0。這是純JavaScript三維坐標/透視，Canvas2D負責最後光柵化；不是2D平移偽裝3D，也不是WebGL/Three、人物GLB或實景3DGS。

正式路徑：plan schema → resolveCodeMotionCompositionImages（無外部資產） → artMotionSpec → 共用studio composition runtime。planner自帶guide已更新；其非靜態檢查原先就允許含morph的非空keyframes。images代理負責工作台pointMorph3d配方，root負責SceneEditor及整合。

## 新路徑驗證

`client/src/lib/codeMotionPointMorphRuntime.test.ts`：6個不同案例。首輪fixture缺grammar、次輪grammar值錯誤，均保存原log；修fixture後schema拒絕案例1 PASS，其他5項受VM boot microtask等待不足影響。改用setImmediate等外部VM任務完成，僅重跑5個未過項，結果5 PASS /1 SKIP。全部產品斷言保持；6案例累計通過，沒有重跑已過schema案例。

- 正式plan→resolve→spec→實際boot→renderFrame，每幀120個有限canvas畫圓命令。
- 三個目標等點數、XYZ均有跨度、固定seed可重放、不同seed不同、形變中點逐點精確。
- 相機orbit中心不移動、離軸點真實depth/透視改變、近裁面生效；未填orbit等同顯式0。
- 逆向/跳躍seek相同畫布命令，點排序由遠及近。
- 靜止相機時形變仍產生不同投影，排除只轉相機冒稱形變。
- 拒絕超額、未知形態、URL、在2D元素上配置morph；合併總點數不放寬。

原始log為 `fixture-schema-attempt.log`、`fixture-grammar-attempt.log`、`fixture-boot-attempt.log`、`runtime-test.log`；實測命令摘要 `runtime.json`。

另新增單一真Chromium像素案例 `codeMotionPointMorph.browser.test.ts`，由主代理默认環境執行。使用正式schema→runtime，無HTTP/遠端素材，檢查240點可見、0/1/2/.5秒畫面不同、逆seek完全同像素hash。主環境真跑1 PASS（14.395s）：`browser-test.log` / `browser.json`。0/1/2/.5秒可見像素13214/13135/12178/13177，四種畫面hash不同；回到1秒、0秒hash分別仍3972971408和767520036，requests為空。完整TS由主代理統一做。

## 邊界

此切片提供球/圓環/螺旋，不包含原方案的樹/葉脈/森林/幼苗、圖像採樣目標、萬點WebGL、bloom或性能承諾。逐幀是絕對時間計算，沒有累積delta/Math.random。跨鏡carry沿舊規則只承接transform終態；不同鏡頭仍須明示相同seed/from/to/count才可連續，沒有自動換點或語義形狀生成。

尚未跑artMotionRender→FFmpeg新成片、1080p性能或正式上線驗收，不能把本次單項Canvas探針稱為影片交付。GPU不是必需，本機無新安裝與付費呼叫。

主代理補接 SceneEditor 新增pointMorph、起止形狀與morph動作欄；editor-test.log新增1case PASS（其餘4原案例未重跑）。其後只補新增結尾節點帶morph:1，已跨檔只讀核對，未另跑同一通過用例。
