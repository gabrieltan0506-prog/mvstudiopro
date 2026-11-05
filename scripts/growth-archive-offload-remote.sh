#!/bin/sh

# 在 Fly 内执行的 archive 冷备辅助脚本。源码由 GitHub Actions 通过 stdin 传入，
# 不依赖 Fly 当前部署版本；所有源目录读取/删除都与采集共用同一跨进程 lease。
set -eu

ROOT="${GROWTH_STORE_DIR:-/data/growth}"
ARCHIVE_ROOT="$ROOT/archive"
SNAPSHOT_PARENT="$ROOT/backups/archive-offload"
COLLECTION_LOCK="$ROOT/.growth-platform-collection.lock"
MUTATION_LOCK="$ROOT/.growth-store-mutation.lock"
mutation_acquired=false
INTERACTIVE_DIR="$ROOT/runtime-interactive-workloads"
LOCK_STALE_MINUTES=15

mode="${1:-}"
batch_id="${2:-}"

case "$batch_id" in
  ""|.|..|*[!0-9A-Za-z._-]*)
    echo "非法 archive offload batch id" >&2
    exit 64
    ;;
esac

snapshot_root="$SNAPSHOT_PARENT/$batch_id"
lock_owner="github-growth-archive:$batch_id:$mode:$$"
lock_acquired=false
heartbeat_pid=""

# A safe basename is insufficient when an owned parent was replaced by a symlink.
# Inspect only our known hierarchy; never traverse a link into unrelated data.
assert_owned_paths() {
  node -e '
    const fs=require("fs"),path=require("path"),root=process.argv[1],batch=process.argv[2];
    for(const file of [root,path.join(root,"archive"),path.join(root,"backups"),path.join(root,"backups/archive-offload"),path.join(root,"backups/archive-offload",batch),path.join(root,"backups/archive-offload",batch+".next")]) {
      let st;try{st=fs.lstatSync(file)}catch(e){if(e.code==="ENOENT")continue;throw e}
      if(!st.isDirectory()||st.isSymbolicLink())throw Error("archive_snapshot_path_type_invalid:"+file);
    }
  ' "$ROOT" "$batch_id"
}

assert_snapshot_owner() {
  node -e '
    const fs=require("fs"),path=require("path"),root=process.argv[1],batch=process.argv[2];
    const file=path.join(root,".snapshot-owner.json"),st=fs.lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink())throw Error("archive_snapshot_owner_type_invalid");
    const owner=JSON.parse(fs.readFileSync(file,"utf8"));
    if(owner.schemaVersion!==1||owner.batchId!==batch||owner.kind!=="archive-hardlink-snapshot")throw Error("archive_snapshot_owner_invalid");
  ' "$snapshot_root" "$batch_id"
}

assert_owned_paths

has_interactive_workload() {
  for lease_dir in "$INTERACTIVE_DIR" "${GROWTH_INTERACTIVE_FALLBACK_DIR:-${TMPDIR:-/tmp}/mvstudiopro-growth-runtime-interactive-workloads}"; do
    [ -d "$lease_dir" ] || continue
    fresh=$(find "$lease_dir" -type f -mmin -2 -print -quit 2>/dev/null) || return 0
    [ -z "$fresh" ] || return 0
  done
  return 1
}

release_collection_lease() {
  if [ -n "$heartbeat_pid" ]; then
    kill "$heartbeat_pid" 2>/dev/null || true
    wait "$heartbeat_pid" 2>/dev/null || true
    heartbeat_pid=""
  fi
  if [ "$lock_acquired" = "true" ] && [ "$(cat "$COLLECTION_LOCK" 2>/dev/null || true)" = "$lock_owner" ]; then
    rm -f -- "$COLLECTION_LOCK"
  fi
  if [ "$mutation_acquired" = "true" ] && mutation_owned; then
    rm -f -- "$MUTATION_LOCK"
  fi
  mutation_acquired=false
  lock_acquired=false
}

mutation_owned() {
  node -e 'try { process.exit(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).token === process.argv[2] ? 0 : 1) } catch { process.exit(1) }' "$MUTATION_LOCK" "$lock_owner"
}
assert_lease() {
  if [ "$(cat "$COLLECTION_LOCK" 2>/dev/null || true)" != "$lock_owner" ] || ! mutation_owned; then
    echo "growth_archive_lease_lost" >&2
    exit 46
  fi
}

acquire_collection_lease() {
  mkdir -p "$ROOT"
  if has_interactive_workload; then
    echo "前台交互任务运行中，archive offload 主动让行" >&2
    echo "GROWTH_ARCHIVE_BUSY" >&2
    exit 42
  fi
  # Never steal a lease based only on age: a paused owner may still be writing.
  if ! (set -C; umask 077; printf '%s' "$lock_owner" > "$COLLECTION_LOCK") 2>/dev/null; then
    echo "采集 lease 竞争失败，archive offload 主动让行" >&2
    echo "GROWTH_ARCHIVE_BUSY" >&2
    exit 43
  fi
  lock_acquired=true
  if ! (set -C; umask 077; printf '{"token":"%s","operation":"archive-snapshot"}' "$lock_owner" > "$MUTATION_LOCK") 2>/dev/null; then
    release_collection_lease
    echo "GROWTH_ARCHIVE_BUSY" >&2
    exit 43
  fi
  mutation_acquired=true
  if has_interactive_workload; then
    release_collection_lease
    echo "取得 lease 后检测到前台交互任务，archive offload 主动让行" >&2
    echo "GROWTH_ARCHIVE_BUSY" >&2
    exit 42
  fi
  (
    while sleep 30; do
      if [ "$(cat "$COLLECTION_LOCK" 2>/dev/null || true)" != "$lock_owner" ]; then
        exit 0
      fi
      mutation_owned || exit 0
      touch "$COLLECTION_LOCK" "$MUTATION_LOCK" || exit 1
    done
  ) >/dev/null 2>&1 &
  heartbeat_pid=$!
}

validate_dir_name() {
  case "$1" in
    ""|.|..|*[!0-9A-Za-z._-]*)
      echo "非法 archive 目录名: $1" >&2
      return 1
      ;;
  esac
}

# du 的目录块大小不能证明有备份内容；只接受正式恢复器可读取的普通文件。
# 返回逻辑字节数，空目录（含仅有子目录）返回 0；链接/特殊文件直接拒绝。
archive_content_bytes() {
  node -e '
    const fs = require("node:fs"), path = require("node:path");
    let bytes = 0, jsonFiles = 0;
    function visit(dir) {
      for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name), st = fs.lstatSync(file);
        if (st.isDirectory()) visit(file);
        else if (st.isFile()) {
          if (!name.endsWith(".json.gz") || st.size === 0) throw new Error(`archive_content_invalid:${file}`);
          bytes += st.size; jsonFiles++;
        } else throw new Error(`archive_content_type_invalid:${file}`);
      }
    }
    visit(process.argv[1]);
    if (!Number.isSafeInteger(bytes)) throw new Error("archive_content_size_invalid");
    console.log(jsonFiles ? bytes : 0);
  ' "$1"
}

# Content identity excludes mutable timestamps. It is also the exact member inventory.
content_inventory() {
  node -e '
    const fs=require("fs"),path=require("path"),crypto=require("crypto"),zlib=require("zlib");
    const root=process.argv[1], report=process.argv[2], rows=[], errors=[], excluded=[], uncovered=[];
    const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
    function visit(dir) {
      for(const name of fs.readdirSync(dir).sort()) {
        const file=path.join(dir,name),relative=path.relative(root,file).split(path.sep).join("/");
        const st=fs.lstatSync(file);
        if(st.isDirectory()){visit(file);continue;}
        const metadata={path:relative,bytes:st.size,type:st.isFile()?"file":st.isSymbolicLink()?"symlink":"special"};
        if(/^(kuaishou|toutiao)[-_.]/i.test(name)){excluded.push({...metadata,reason:"user-excluded-platform"});continue;}
        if(name.startsWith("._")){excluded.push({...metadata,reason:"filesystem-metadata"});continue;}
        if(!/^(douyin|xiaohongshu|bilibili|weixin_channels|wechat|tiktok)[-_.]/.test(name)) {
          uncovered.push({...metadata,reason:"unknown-platform-prefix"});continue;
        }
        try {
          if(!st.isFile()||!name.endsWith(".json.gz")||/[\\\t\r\n]/.test(relative)) throw Error("invalid_type_or_name");
          if(!st.size) throw Error("zero_bytes");
          const raw=fs.readFileSync(file), value=JSON.parse(zlib.gunzipSync(raw,{maxOutputLength:512*1024*1024}));
          if(!value||!Array.isArray(value.items)) throw Error("items_not_array");
          const after=fs.lstatSync(file);
          if(after.ino!==st.ino||after.size!==st.size||after.mtimeMs!==st.mtimeMs) throw Error("source_changed");
          rows.push({path:relative,bytes:raw.length,sha256:hash(raw),items:value.items.length});
        } catch(e) {
          if(e.code && ["EACCES","EIO","ENOSPC","EMFILE"].includes(e.code)) throw e;
          errors.push({path:relative,reason:e.message});
        }
      }
    }
    visit(root);
    const result={dir:path.basename(root),scope:"authorized-platform-files",files:rows,errors,excluded,uncovered};
    fs.writeFileSync(report,JSON.stringify(result));
    if(uncovered.length) console.error("GROWTH_ARCHIVE_UNCOVERED "+JSON.stringify({dir:result.dir,files:uncovered}));
    if(errors.length){console.error("GROWTH_ARCHIVE_ANOMALY "+JSON.stringify(result));process.exit(65);}
    const identity=rows.map(({path,bytes,sha256})=>[path,bytes,sha256]);
    console.log(hash(JSON.stringify(identity))+"\t"+rows.reduce((n,f)=>n+f.bytes,0));
  ' "$1" "$2"
}

# Link only the content-verified allowlist. Never copy a mixed-platform bucket wholesale.
link_inventory_files() {
  node -e '
    const fs=require("fs"),path=require("path"),crypto=require("crypto");
    const [sourceRoot,targetRoot,manifest]=process.argv.slice(1);
    const inventory=JSON.parse(fs.readFileSync(manifest,"utf8"));
    if(inventory.errors.length) throw Error("archive_snapshot_contains_errors");
    fs.mkdirSync(targetRoot);
    for(const row of inventory.files) {
      const parts=row.path.split("/");
      if(!row.path || path.isAbsolute(row.path) || /[\\\t\r\n]/.test(row.path) || parts.some(p=>!p||p==="."||p==="..")) throw Error("archive_snapshot_path_invalid");
      let ancestor=sourceRoot;
      if(!fs.lstatSync(ancestor).isDirectory()) throw Error("archive_snapshot_root_invalid");
      for(const part of parts.slice(0,-1)){ancestor=path.join(ancestor,part);if(!fs.lstatSync(ancestor).isDirectory())throw Error("archive_snapshot_parent_invalid");}
      const source=path.join(sourceRoot,...parts),target=path.join(targetRoot,...parts);
      const before=fs.lstatSync(source);
      if(!before.isFile() || before.size!==row.bytes) throw Error("archive_snapshot_source_changed");
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.linkSync(source,target);
      const linked=fs.lstatSync(target);
      if(!linked.isFile() || linked.ino!==before.ino || linked.dev!==before.dev) throw Error("archive_snapshot_source_changed");
      const raw=fs.readFileSync(target),after=fs.lstatSync(target);
      if(raw.length!==row.bytes || crypto.createHash("sha256").update(raw).digest("hex")!==row.sha256
          || after.ino!==linked.ino || after.size!==linked.size || after.mtimeMs!==linked.mtimeMs) throw Error("archive_snapshot_source_changed");
    }
  ' "$1" "$2" "$3"
}

# 失败只能回收本次创建并仍持有标记的临时目录；旧证据一律保留。
cleanup_failed_snapshot() {
  [ "${snapshot_next_owned:-false}" = "true" ] || return 0
  node -e '
    const fs=require("fs"),path=require("path"),root=process.argv[1],token=process.argv[2];
    let st;try{st=fs.lstatSync(root)}catch(e){if(e.code==="ENOENT")process.exit(0);throw e}
    if(!st.isDirectory()||st.isSymbolicLink())throw Error("archive_failed_snapshot_type_changed");
    const marker=path.join(root,".snapshot-owner.json"),ms=fs.lstatSync(marker);
    if(!ms.isFile()||ms.isSymbolicLink())throw Error("archive_failed_snapshot_owner_changed");
    if(JSON.parse(fs.readFileSync(marker,"utf8")).creationToken!==token)throw Error("archive_failed_snapshot_owner_changed");
    fs.rmSync(root,{recursive:true});
  ' "$snapshot_next" "$snapshot_creation_token"
}

prepare_snapshot() {
  probe_dir="${1:-}"
  node -e 'const v=process.argv[1];if(v&&(!/^\d{4}-\d{2}-\d{2}(?:-\d{2})?$/.test(v)||/[\r\n]/.test(v)))throw Error("archive_probe_directory_invalid");' "$probe_dir"
  acquire_collection_lease
  snapshot_next="$snapshot_root.next"
  snapshot_next_owned=false
  snapshot_creation_token=$(node -e 'console.log(require("crypto").randomUUID())')
  trap 'cleanup_failed_snapshot || echo "临时快照所有权变化，保留证据" >&2; release_collection_lease' EXIT HUP INT TERM
  if [ ! -d "$ARCHIVE_ROOT" ]; then
    exit 0
  fi

  mkdir -p "$SNAPSHOT_PARENT"
  # workflow 被强制取消时 always 清理可能来不及执行；下个串行批次只回收旧临时快照，
  # 该目录全部是 hardlink 副本，绝不触碰 ARCHIVE_ROOT 源目录。
  if [ -f "$snapshot_root/snapshot.tsv" ]; then
    # SSH 在远端原子 mv 完成后断线时，本地可安全复用同一批次，避免覆盖或重复快照。
    assert_snapshot_owner
    # 旧快照没有probeDir，只能按原默认范围复用；不可把全量或另一桶冒充本次探针。
    node -e 'const fs=require("fs"),m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if((m.probeDir===undefined?"":m.probeDir)!==process.argv[2])throw Error("archive_snapshot_probe_scope_mismatch");' "$snapshot_root/.snapshot-owner.json" "$probe_dir"
    cat "$snapshot_root/snapshot.tsv"
    return 0
  fi
  if [ -e "$snapshot_next" ]; then
    echo "archive 临时目录已存在，保留旧证据，拒绝覆盖: $batch_id" >&2
    exit 65
  fi
  if [ -e "$snapshot_root" ]; then
    echo "archive offload 快照批次已存在，拒绝覆盖: $batch_id" >&2
    exit 65
  fi
  mkdir "$snapshot_next"
  printf '{"schemaVersion":1,"batchId":"%s","kind":"archive-hardlink-snapshot","creationToken":"%s","probeDir":"%s"}' "$batch_id" "$snapshot_creation_token" "$probe_dir" > "$snapshot_next/.snapshot-owner.json"
  snapshot_next_owned=true

  all_dirs="$snapshot_next/.all-dirs"
  archive_dirs="$snapshot_next/.archive-dirs"
  selected_dirs="$snapshot_next/.selected-dirs"
  find "$ARCHIVE_ROOT" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | LC_ALL=C sort > "$all_dirs"
  # 同时兼容旧的日目录与新的小时目录。无论磁盘多紧，都保留最新两个分桶，
  # 绝不再把仍由采集写入的活动目录拿去上传；否则上传完成后的源指纹必然变化。
  grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]{2})?$' "$all_dirs" | LC_ALL=C sort > "$archive_dirs" || true
  awk '{ lines[NR]=$0 } END { for (i=1; i<=NR-2; i++) print lines[i] }' "$archive_dirs" > "$selected_dirs"
  # 非日期目录不在正式冷读恢复契约中，不进入自动发布/删源链。
  LC_ALL=C sort -u "$selected_dirs" -o "$selected_dirs"
  # 只在日期及最新两桶门禁之后缩小范围，避免单桶探针仍哈希全盘。
  if [ -n "$probe_dir" ]; then
    if ! grep -Fxq "$probe_dir" "$selected_dirs"; then
      echo "archive_probe_directory_not_eligible" >&2
      exit 64
    fi
    printf '%s\n' "$probe_dir" > "$selected_dirs"
  else
    # 默认轮转仅做有界候选的metadata估算；整桶超限显式延后，绝不截断内容。
    node -e '
      const fs=require("fs"),path=require("path"),root=process.argv[1],list=process.argv[2],out=process.argv[3],batch=process.argv[4];
      const cursorFile=path.join(root,"backups/archive-offload/.rotation-cursor.json");
      let cursor=null;
      if(fs.existsSync(cursorFile)){const st=fs.lstatSync(cursorFile);if(!st.isFile()||st.isSymbolicLink())throw Error("archive_rotation_cursor_type");cursor=JSON.parse(fs.readFileSync(cursorFile,"utf8"));if(cursor.schemaVersion!==1||typeof cursor.lastDir!=="string")throw Error("archive_rotation_cursor_invalid");}
      const dirs=fs.readFileSync(list,"utf8").trim().split(/\n/).filter(Boolean),start=cursor?dirs.findIndex(d=>d>cursor.lastDir):0;
      const offset=start<0?0:start,ordered=[...dirs.slice(offset),...dirs.slice(0,offset)],selected=[],visited=[],oversized=[];
      const maxBytes=512*1024*1024;let estimatedBytes=0;
      function size(dir){let bytes=0;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())bytes+=size(p);else if(e.isFile())bytes+=fs.lstatSync(p).size;}return bytes;}
      for(const dir of ordered){if(visited.length>=12)break;const bytes=size(path.join(root,"archive",dir));if(bytes>maxBytes){visited.push(dir);oversized.push({dir,reason:"oversized",estimatedBytes:bytes});continue;}if(estimatedBytes+bytes>maxBytes)break;visited.push(dir);selected.push(dir);estimatedBytes+=bytes;}
      const deferred=ordered.filter(d=>!visited.includes(d)).map(dir=>({dir,reason:"rotation-budget"})).concat(oversized);
      const report={schemaVersion:1,batchId:batch,eligibleCount:dirs.length,scannedCount:visited.length,selectedCount:selected.length,estimatedBytes,maxBuckets:12,maxBytes,cursorBefore:cursor?.lastDir||null,cursorAfter:visited.at(-1)||cursor?.lastDir||null,deferred,oversized};
      fs.writeFileSync(out,JSON.stringify(report));fs.writeFileSync(list,selected.length?selected.join("\n")+"\n":"");
      console.error("GROWTH_ARCHIVE_ROTATION "+JSON.stringify({eligible:report.eligibleCount,visited:report.scannedCount,selected:report.selectedCount,deferred:deferred.length,oversized:oversized.length,sourceRetained:true}));
      if(deferred.length)console.error("GROWTH_ARCHIVE_DEFERRED "+JSON.stringify(deferred));
    ' "$ROOT" "$selected_dirs" "$snapshot_next/rotation.json" "$batch_id"
  fi

  plan="$snapshot_next/snapshot.tsv"
  : > "$plan"
  mkdir "$snapshot_next/inventories"
  : > "$snapshot_next/anomalies.jsonl"
  : > "$snapshot_next/retired.jsonl"
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    validate_dir_name "$dir"
    if has_interactive_workload; then
      echo "创建 archive 快照时出现前台交互任务，本轮让行" >&2
      echo "GROWTH_ARCHIVE_BUSY" >&2
      exit 42
    fi
    assert_lease
    # B站已退役后，剩余平台子集不能发布为新的整桶版本。
    if [ -e "$ROOT/.growth-archive-retired/$dir.json" ] || [ -L "$ROOT/.growth-archive-retired/$dir.json" ]; then
      node -e '
        const fs=require("fs"),path=require("path"),root=process.argv[1],dir=process.argv[2];
        let state="retired",reason="complete-cold-backup-retained";
        try {
          const parent=path.join(root,".growth-archive-retired"),file=path.join(parent,dir+".json");
          if(!fs.lstatSync(parent).isDirectory()||!fs.lstatSync(file).isFile())throw Error("marker-type");
          const m=JSON.parse(fs.readFileSync(file,"utf8"));
          if(m.schemaVersion!==1||m.dir!==dir||m.platform!=="bilibili"||!/^[a-f0-9]{64}$/.test(m.receiptSha256)||m.restore?.dir!==dir)throw Error("marker-contract");
        } catch(e) {state="retirement-marker-invalid";reason="manual-review-required";}
        const row=JSON.stringify({dir,state,reason});console.log(row);console.error("GROWTH_ARCHIVE_RETIRED "+row);
      ' "$ROOT" "$dir" >> "$snapshot_next/retired.jsonl"
      if [ -n "$probe_dir" ]; then
        echo "archive_probe_directory_retired" >&2
        exit 64
      fi
      continue
    fi
    inventory="$snapshot_next/inventories/$dir.json"
    if identity=$(content_inventory "$ARCHIVE_ROOT/$dir" "$inventory"); then
      :
    else
      status=$?
      [ "$status" -eq 65 ] || exit "$status"
      cat "$inventory" >> "$snapshot_next/anomalies.jsonl"
      printf '\n' >> "$snapshot_next/anomalies.jsonl"
      continue
    fi
    fingerprint=$(printf '%s' "$identity" | cut -f1)
    bytes=$(printf '%s' "$identity" | cut -f2)
    if [ "$bytes" -eq 0 ]; then
      echo "跳过无本次范围内容的归档目录，保留来源与已有冷备: $dir" >&2
      continue
    fi
    link_inventory_files "$ARCHIVE_ROOT/$dir" "$snapshot_next/$dir" "$inventory"
    assert_lease
    printf '%s\t%s\t%s\n' "$dir" "$fingerprint" "$bytes" >> "$plan"
    echo "GROWTH_ARCHIVE_PROGRESS $dir" >&2
  done < "$selected_dirs"

  rm -f -- "$all_dirs" "$archive_dirs" "$selected_dirs"
  assert_lease
  mv "$snapshot_next" "$snapshot_root"
  # 只在完整快照已原子发布后推进；同batch重入在前面返回，不二次推进。
  if [ -z "$probe_dir" ]; then
    node -e '
      const fs=require("fs"),path=require("path"),root=process.argv[1],batch=process.argv[2],r=JSON.parse(fs.readFileSync(path.join(root,batch,"rotation.json"),"utf8"));
      if(r.cursorAfter){const file=path.join(root,".rotation-cursor.json"),next=file+"."+batch+".next";if(fs.existsSync(file)&&(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()))throw Error("archive_rotation_cursor_type");const fd=fs.openSync(next,"wx",0o600);try{fs.writeFileSync(fd,JSON.stringify({schemaVersion:1,batchId:batch,lastDir:r.cursorAfter}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(next,file);const parent=fs.openSync(root,"r");try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}
    ' "$SNAPSHOT_PARENT" "$batch_id"
  fi
  cat "$snapshot_root/snapshot.tsv"
}

stream_bundle() {
  dir="${1:-}"
  validate_dir_name "$dir"
  # Serialize streaming with snapshot cleanup and cooperative source writers.
  acquire_collection_lease
  trap 'release_collection_lease' EXIT HUP INT TERM
  assert_snapshot_owner
  if has_interactive_workload; then
    echo "前台交互任务运行中，archive 压缩主动让行" >&2
    echo "GROWTH_ARCHIVE_BUSY" >&2
    exit 42
  fi
  source_dir="$snapshot_root/$dir"
  if [ ! -d "$source_dir" ]; then
    echo "archive 快照目录不存在: $dir" >&2
    exit 66
  fi
  bytes=$(archive_content_bytes "$source_dir")
  if [ "$bytes" -eq 0 ]; then
    echo "archive_content_empty:$dir" >&2
    exit 65
  fi

  # gzip success must not hide a tar failure. The snapshot is immutable under atomic writers.
  node -e '
    const {spawn}=require("child_process"),{pipeline}=require("stream/promises"),{createGzip}=require("zlib");
    const child=spawn("nice",["-n","19","tar","-C",process.argv[1],"-cf","-","--",process.argv[2]],{stdio:["ignore","pipe","inherit"],env:{...process.env,COPYFILE_DISABLE:"1"}});
    const exit=new Promise((resolve,reject)=>{child.on("error",reject);child.on("close",code=>code===0?resolve():reject(Error("archive_tar_failed:"+code)));});
    Promise.all([pipeline(child.stdout,createGzip({level:1}),process.stdout),exit]).catch(e=>{console.error(e.message);child.kill();process.exitCode=1;});
  ' "$snapshot_root" "$dir"

}

delete_verified_source() {
  # Scheduled backups never authorize deletion. A separate reviewed receipt must name
  # exact Bilibili files, source hashes and a completed restore, not a whole bucket.
  echo "growth_archive_delete_requires_explicit_file_receipt" >&2
  exit 64
}

snapshot_report() {
  node -e '
    const fs=require("fs"),path=require("path"),root=process.argv[1];
    const inventories=Object.fromEntries(fs.readdirSync(path.join(root,"inventories")).sort().map(n=>[n.slice(0,-5),JSON.parse(fs.readFileSync(path.join(root,"inventories",n),"utf8"))]));
    const retired=(fs.existsSync(path.join(root,"retired.jsonl"))?fs.readFileSync(path.join(root,"retired.jsonl"),"utf8"):"").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const rotationFile=path.join(root,"rotation.json"),rotation=fs.existsSync(rotationFile)?JSON.parse(fs.readFileSync(rotationFile,"utf8")):null;
    console.log(JSON.stringify({schemaVersion:1,inventories,retired,rotation,deferred:rotation?.deferred||[],anomalies:Object.values(inventories).filter(v=>v.errors.length),
      uncovered:Object.values(inventories).flatMap(v=>(v.uncovered||[]).map(row=>({dir:v.dir,...row}))),
      excluded:Object.values(inventories).flatMap(v=>(v.excluded||[]).map(row=>({dir:v.dir,...row}))),fullStoreComplete:false}));
  ' "$snapshot_root"
}

cleanup_snapshot() {
  # 这里只清理已验证批次的临时 hardlink；不触碰 archive 源目录。
  acquire_collection_lease
  trap 'release_collection_lease' EXIT HUP INT TERM
  [ -e "$snapshot_root" ] || return 0
  assert_owned_paths
  assert_snapshot_owner
  assert_lease
  rm -rf -- "$snapshot_root"
}

cleanup_current_batch() {
  # Legacy bypass had no owner checks. Use the dedicated owner-aware CLI instead.
  echo "growth_current_cleanup_requires_owned_snapshot_cli" >&2
  exit 64
}

case "$mode" in
  prepare) prepare_snapshot "${3:-}" ;;
  report) snapshot_report ;;
  bundle) stream_bundle "${3:-}" ;;
  delete) delete_verified_source "${3:-}" "${4:-}" ;;
  cleanup) cleanup_snapshot ;;
  cleanup-current-batch) cleanup_current_batch ;;
  *)
    echo "用法: $0 {prepare|bundle|delete|cleanup|cleanup-current-batch} BATCH_ID [DIR] [SOURCE_FINGERPRINT]" >&2
    exit 64
    ;;
esac
