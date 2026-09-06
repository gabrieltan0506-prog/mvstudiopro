import { createHash } from "node:crypto";

/** 全片隔离实验：不改变正式学习入口，所有取舍均保留来源和未解决项。 */
type Row = Record<string, unknown>;
export type BoundaryEvidenceKind =
  | "shot"
  | "keyMoment"
  | "subtitle"
  | "audioTrack"
  | "audioCue";
export type BoundaryAttempt = {
  sourceDigest: string;
  segmentIndex: number;
  attemptNumber: number;
  startSec: number;
  endSec: number;
  rawObjectName: string;
  raw: Row;
  gate: { status: "accepted" | "rejected"; reasonZh?: string };
};
export type BoundaryEvidence = {
  id: string;
  kind: BoundaryEvidenceKind;
  path: string;
  segmentIndex: number;
  attemptNumber: number;
  row: Row;
  exactGroup: string;
  issues: string[];
};
const record = (value: unknown): value is Row =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const rows = (value: unknown): Row[] =>
  Array.isArray(value)
    ? value.map(item => {
        if (!record(item))
          throw new Error("证据数组含非对象记录，停止而非静默丢弃");
        return item;
      })
    : [];
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
const sha = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const pointKeys = new Set(["keyMoment", "subtitle", "audioCue"]);

/** 时间重复和文案相似均不足以判重复；只预合并同来源同位置的完全相同证据。 */
export function buildBoundaryEvidenceBundle(
  attempts: readonly BoundaryAttempt[]
) {
  if (!attempts.length || new Set(attempts.map(a => a.sourceDigest)).size !== 1)
    throw new Error("实验来源为空或混入其他影片");
  const identities = attempts.map(a => `${a.segmentIndex}:${a.attemptNumber}`);
  if (new Set(identities).size !== identities.length)
    throw new Error("同一尝试重复进入证据包");
  const evidence: BoundaryEvidence[] = [];
  const annotated = attempts.map(attempt => {
    if (
      !attempt.rawObjectName ||
      !attempt.sourceDigest ||
      !Number.isInteger(attempt.segmentIndex) ||
      !Number.isInteger(attempt.attemptNumber)
    )
      throw new Error("尝试缺少真实来源身份");
    const raw = copy(attempt.raw);
    const rawSha256 = sha(attempt.raw);
    const add = (
      row: Row,
      kind: BoundaryEvidenceKind,
      path: string,
      parent?: Row
    ) => {
      const original = copy(row);
      delete original._sourceIds;
      delete original._evidenceId;
      const own = { ...original };
      if (kind === "audioTrack") delete own.cues;
      const id = `e_${sha({ source: attempt.sourceDigest, segment: attempt.segmentIndex, attempt: attempt.attemptNumber, rawSha256, path }).slice(0, 24)}`;
      const issues: string[] = [];
      const local = kind === "audioTrack" || kind === "audioCue";
      const lower = local ? 0 : attempt.startSec,
        upper = local ? attempt.endSec - attempt.startSec : attempt.endSec;
      const from = pointKeys.has(kind)
        ? row.atSec
        : kind === "audioTrack"
          ? row.fromSec
          : row.startSec;
      const to = pointKeys.has(kind)
        ? from
        : kind === "audioTrack"
          ? row.toSec
          : row.endSec;
      if (
        !finite(from) ||
        !finite(to) ||
        from < lower ||
        to > upper ||
        (pointKeys.has(kind) ? to < from : to <= from)
      )
        issues.push("时间字段缺失、倒置或超出原分片");
      if (parent?._wrongChunkIndex === true)
        issues.push("原稿音轨段号与该次实际输入分片不一致");
      if (
        kind === "audioCue" &&
        parent &&
        finite(from) &&
        finite(parent.fromSec) &&
        finite(parent.toSec) &&
        (from < parent.fromSec || from > parent.toSec)
      )
        issues.push("声音事件不在所属音轨区间");
      if (
        kind === "shot" &&
        row.evidenceRole !== "non_story_ad" &&
        (typeof row.hintZh !== "string" || !row.hintZh.trim())
      )
        issues.push("缺少非空镜头观察");
      evidence.push({
        id,
        kind,
        path,
        segmentIndex: attempt.segmentIndex,
        attemptNumber: attempt.attemptNumber,
        row: own,
        exactGroup: sha({
          source: attempt.sourceDigest,
          segment: attempt.segmentIndex,
          kind,
          row: own,
        }),
        issues,
      });
      row._sourceIds = [id];
      if (issues.length) row._sourceIssuesZh = issues;
    };
    rows(raw.shots).forEach((row, index) =>
      add(row, "shot", `shots[${index}]`)
    );
    rows(raw.keyMoments).forEach((row, index) =>
      add(row, "keyMoment", `keyMoments[${index}]`)
    );
    rows(raw.subtitles).forEach((row, index) =>
      add(row, "subtitle", `subtitles[${index}]`)
    );
    rows(raw.audioResolution).forEach((chunk, ci) => {
      rows(
        record(chunk.analysis) ? chunk.analysis.audioTrack : undefined
      ).forEach((track, ti) => {
        const parent = {
          ...track,
          _wrongChunkIndex: chunk.chunkIndex !== attempt.segmentIndex,
        };
        add(
          track,
          "audioTrack",
          `audioResolution[${ci}].analysis.audioTrack[${ti}]`,
          parent
        );
        rows(track.cues).forEach((cue, qi) =>
          add(
            cue,
            "audioCue",
            `audioResolution[${ci}].analysis.audioTrack[${ti}].cues[${qi}]`,
            parent
          )
        );
      });
    });
    raw._sourceAttempt = {
      sourceDigest: attempt.sourceDigest,
      rawSha256,
      rawObjectName: attempt.rawObjectName,
      segmentIndex: attempt.segmentIndex,
      attemptNumber: attempt.attemptNumber,
      gate: attempt.gate,
    };
    return raw;
  });
  return { sourceDigest: attempts[0]!.sourceDigest, annotated, evidence };
}

export const BOUNDARY_PROVENANCE_INSTRUCTION_ZH = `
【本次全片实验的来源与去重契约】
输入包括同一分片的各次完整原稿，_sourceAttempt记录程序验收结果，但通过版不自动优先，拒收版也不自动作废。_sourceIssuesZh只说明具体记录的可检测问题，不证明其他描述真实。
镜头、重点时刻、字幕、每条音轨及每个声音事件均带_sourceIds。输出相应记录必须带它实际采用的全部_sourceIds，不能编造ID、跨影片引用或将无关来源挂到某条记录上。
同一时间同一事件的重复记录归并，来源ID取并集；不同时间的相似台词、动作和机位分别保留。同一镜头有兼容的不同字段时可从各来源取值；事实字段保持来源原文，不添加人物、动作、关系、对白或声音。不能把互相矛盾的观察拼成新剧情。
同镜兼容的不同原文可在_sourceAlternatives中保存，每项为sourceId和fields对象，fields只放该来源未进入主字段的原文。不要改写或概括这些替代观察。程序逐字段核对，挂上来源ID却丢掉不同观察也算丢失。
相互冲突、无法确认去向的证据保留在顶层_unresolvedEvidence中，每项包含sourceIds和具体reasonZh；程序不会把这些项算作已解决。不能把资料不足的正文强行补齐，也不能用延长区间制造覆盖。
每个输入_sourceIds都必须出现在实际采用的输出记录或_unresolvedEvidence中。原稿仅因其他地方未过门禁，不能成为丢弃本条的理由。已有重复可合并，但每个被合并来源的不同事实字段必须得到保留或明确列为未解决。
`;

/** 对账每条来源，而不是用三稿总镜数除以去重结果；冲突与失踪分开报告。 */
export function auditBoundaryEvidenceOutput(
  bundle: ReturnType<typeof buildBoundaryEvidenceBundle>,
  output: Row
) {
  const index = new Map(bundle.evidence.map(row => [row.id, row]));
  const used = new Set<string>(),
    unresolved = new Set<string>(),
    errors: string[] = [];
  const retainedFields = new Map<string, Set<string>>();
  const check = (
    row: Row,
    kind: BoundaryEvidenceKind,
    path: string,
    segmentIndex?: number
  ) => {
    const ids = Array.isArray(row._sourceIds) ? row._sourceIds : [];
    if (!ids.length || ids.some(id => typeof id !== "string")) {
      errors.push(`${path}缺少合法来源ID`);
      return;
    }
    const sources: BoundaryEvidence[] = [];
    for (const id of ids) {
      const source = index.get(String(id));
      if (
        !source ||
        source.kind !== kind ||
        (segmentIndex !== undefined && source.segmentIndex !== segmentIndex)
      )
        errors.push(`${path}引用不存在或类别/分片不一致的来源${id}`);
      else {
        sources.push(source);
        used.add(source.id);
      }
    }
    if (new Set(sources.map(source => source.segmentIndex)).size > 1)
      errors.push(`${path}把不同分片证据混成一条`);
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith("_") || key === "cues" || key === "craftReadZh")
        continue;
      if (
        !sources.some(source => canonical(source.row[key]) === canonical(value))
      )
        errors.push(`${path}.${key}没有逐字段原始依据`);
      for (const source of sources)
        if (canonical(source.row[key]) === canonical(value)) {
          const fields = retainedFields.get(source.id) || new Set<string>();
          fields.add(key);
          retainedFields.set(source.id, fields);
        }
    }
    for (const alternative of rows(row._sourceAlternatives)) {
      const source = sources.find(s => s.id === alternative.sourceId);
      if (!source || !record(alternative.fields)) {
        errors.push(`${path}替代观察没有有效的本条来源`);
        continue;
      }
      for (const [key, value] of Object.entries(alternative.fields)) {
        if (
          key.startsWith("_") ||
          canonical(source.row[key]) !== canonical(value)
        ) {
          errors.push(`${path}替代观察${key}不属于原稿`);
          continue;
        }
        const fields = retainedFields.get(source.id) || new Set<string>();
        fields.add(key);
        retainedFields.set(source.id, fields);
      }
    }
    // 不允许从两条不同镜头分别取起点和终点，拼出没有依据的新区间。
    const fromKey = kind === "audioTrack" ? "fromSec" : "startSec",
      toKey = kind === "audioTrack" ? "toSec" : "endSec";
    if (
      !pointKeys.has(kind) &&
      !sources.some(
        source =>
          source.row[fromKey] === row[fromKey] &&
          source.row[toKey] === row[toKey]
      )
    )
      errors.push(`${path}时间区间不属于任一来源`);
  };
  rows(output.shots).forEach((r, i) => check(r, "shot", `shots[${i}]`));
  rows(output.keyMoments).forEach((r, i) =>
    check(r, "keyMoment", `keyMoments[${i}]`)
  );
  rows(output.subtitles).forEach((r, i) =>
    check(r, "subtitle", `subtitles[${i}]`)
  );
  rows(output.audioResolution).forEach((chunk, ci) =>
    rows(
      record(chunk.analysis) ? chunk.analysis.audioTrack : undefined
    ).forEach((track, ti) => {
      check(
        track,
        "audioTrack",
        `audioResolution[${ci}].audioTrack[${ti}]`,
        Number(chunk.chunkIndex)
      );
      rows(track.cues).forEach((cue, qi) =>
        check(
          cue,
          "audioCue",
          `audioResolution[${ci}].audioTrack[${ti}].cues[${qi}]`,
          Number(chunk.chunkIndex)
        )
      );
    })
  );
  for (const item of rows(output._unresolvedEvidence)) {
    if (
      !Array.isArray(item.sourceIds) ||
      !item.sourceIds.length ||
      typeof item.reasonZh !== "string" ||
      !item.reasonZh.trim()
    ) {
      errors.push("未解决证据缺少来源或原因");
      continue;
    }
    for (const id of item.sourceIds)
      if (typeof id !== "string" || !index.has(id))
        errors.push("未解决证据引用不存在的来源");
      else unresolved.add(id);
  }
  const missing = bundle.evidence
    .filter(source => !used.has(source.id) && !unresolved.has(source.id))
    .map(source => source.id);
  const lostFields: Array<{ id: string; fields: string[] }> = [];
  for (const source of bundle.evidence)
    if (used.has(source.id) && !unresolved.has(source.id)) {
      const fields = Object.keys(source.row).filter(
        key =>
          !key.startsWith("_") &&
          key !== "craftReadZh" &&
          key !== "cues" &&
          !retainedFields.get(source.id)?.has(key)
      );
      if (fields.length) lostFields.push({ id: source.id, fields });
    }
  const groups = new Map<string, BoundaryEvidence[]>();
  for (const row of bundle.evidence)
    groups.set(row.exactGroup, [...(groups.get(row.exactGroup) || []), row]);
  const unique = Array.from(groups.values());
  const retainedUnique = unique.filter(group =>
    group.some(
      source =>
        used.has(source.id) &&
        !unresolved.has(source.id) &&
        !lostFields.some(lost => lost.id === source.id)
    )
  ).length;
  return {
    sourceRecords: bundle.evidence.length,
    exactUniqueEvidence: unique.length,
    retainedUniqueEvidence: retainedUnique,
    retainedRatio: unique.length ? retainedUnique / unique.length : 0,
    usedSourceIds: used.size,
    unresolvedSourceIds: unresolved.size,
    missingSourceIds: missing,
    lostFields,
    errors,
    traceabilityPassed: !missing.length && !lostFields.length && !errors.length,
    fullyResolved:
      !missing.length &&
      !lostFields.length &&
      !errors.length &&
      unresolved.size === 0,
  };
}

/** 只给隔离实验使用；A保留原请求，B仅改先镜头后重点，C再增加画面落点字段。 */
export function applyBoundaryExperimentOrder(body: Row, arm: "A" | "B" | "C") {
  const result = copy(body);
  if (arm === "A") return result;
  const config = result.generationConfig as Row,
    schema = config.responseSchema as Row,
    props = schema.properties as Row;
  schema.properties = {
    shots: props.shots,
    ...Object.fromEntries(
      Object.entries(props).filter(([key]) => key !== "shots")
    ),
  };
  schema.propertyOrdering = Object.keys(schema.properties as Row);
  for (const content of rows(result.contents))
    for (const part of rows(content.parts))
      if (typeof part.text === "string") {
        part.text = part.text.replace(
          "先定 keyMoments 再决定各镜档位；",
          "先沿时间顺序完整记录 shots，再从这些已记录镜头提取 keyMoments；"
        );
      }
  if (arm === "C") {
    const shots = props.shots as Row,
      item = shots.items as Row;
    for (const branch of rows(item.anyOf)) {
      const branchProps = branch.properties as Row;
      branchProps.startSec = {
        ...(branchProps.startSec as Row),
        type: "INTEGER",
        description:
          "读取视频底部T时钟，填写本镜开始的全片整数秒；同秒短镜由不同帧号区分。",
      };
      branchProps.endSec = {
        ...(branchProps.endSec as Row),
        type: "INTEGER",
        description:
          "本镜结束的全片整数秒；不得用小数秒，准确边界另填endFrame。",
      };
      branchProps.observedAtSec = {
        type: "INTEGER",
        description: "观察画面底部T显示的全片整数秒。",
      };
      branchProps.startFrame = {
        type: "INTEGER",
        description:
          "本镜开始画面底部F显示的本段原帧编号，可参考候选切点帧号。",
      };
      branchProps.endFrame = {
        type: "INTEGER",
        description:
          "下一镜开始画面的F编号，或本段结束标记帧号；必须大于startFrame。",
      };
      branchProps.observedFrame = {
        type: "INTEGER",
        description:
          "本镜人物和动作描述实际成立时画面底部F编号，位于startFrame与endFrame之间。",
      };
      const extra = [
        "observedAtSec",
        "startFrame",
        "endFrame",
        "observedFrame",
      ];
      branch.required = [...(branch.required as string[]), ...extra];
      branch.propertyOrdering = [
        ...(branch.propertyOrdering as string[]),
        ...extra,
      ];
    }
    for (const content of rows(result.contents))
      for (const part of rows(content.parts))
        if (typeof part.text === "string")
          part.text = part.text
            .replaceAll("可保留一位小数", "填写整数秒")
            .replaceAll("可含一位小数", "只用整数秒");
  }
  return result;
}

/** 原始供应商JSON不动；只从真实帧时钟生成独立的内部时间转换稿。 */
export function groundBoundaryFrameTimes(
  raw: Row,
  clock: {
    offset: number;
    actualDurationSec: number;
    frames: Array<{ frame: number; localSec: number }>;
  }
) {
  if (
    !clock.frames.length ||
    clock.frames.some(
      (frame, index) => frame.frame !== index || !finite(frame.localSec)
    )
  )
    throw new Error("原片帧时钟无效");
  const result = copy(raw),
    issues: Array<{ index: number; reasonZh: string }> = [],
    conversions: Row[] = [];
  rows(result.shots).forEach((shot, index) => {
    const a = Number(shot.startFrame),
      b = Number(shot.endFrame),
      o = Number(shot.observedFrame);
    if (
      ![shot.startFrame, shot.endFrame, shot.observedFrame].every(
        value => typeof value === "number" && Number.isInteger(value)
      ) ||
      a < 0 ||
      b > clock.frames.length ||
      b <= a ||
      o < a ||
      o >= b
    ) {
      issues.push({
        index,
        reasonZh: "画面编号不存在、顺序倒置或观察落点不在本镜",
      });
      return;
    }
    const startSec = clock.offset + clock.frames[a]!.localSec;
    const endSec =
      clock.offset +
      (b === clock.frames.length
        ? clock.actualDurationSec
        : clock.frames[b]!.localSec);
    const observedAtSec = clock.offset + clock.frames[o]!.localSec;
    if (
      ![shot.startSec, shot.endSec, shot.observedAtSec].every(
        value => typeof value === "number" && Number.isInteger(value)
      ) ||
      Math.abs(Number(shot.startSec) - Math.floor(startSec)) > 1 ||
      Math.abs(Number(shot.endSec) - Math.floor(endSec)) > 1 ||
      Number(shot.observedAtSec) !== Math.floor(observedAtSec)
    ) {
      issues.push({
        index,
        reasonZh: "整数秒与原帧时钟不符，不能用帧号掩盖错误",
      });
      return;
    }
    conversions.push({
      index,
      sourceIntegerSeconds: {
        startSec: shot.startSec,
        endSec: shot.endSec,
        observedAtSec: shot.observedAtSec,
      },
      sourceFrames: { startFrame: a, endFrame: b, observedFrame: o },
      resolvedSeconds: { startSec, endSec, observedAtSec },
    });
    Object.assign(shot, { startSec, endSec, observedAtSec });
  });
  return { raw: result, issues, conversions };
}

export type BoundaryFactUnit = {
  id: string;
  kind: BoundaryEvidenceKind;
  segmentIndex: number;
  row: Row;
  sourceIds: string[];
  status: "consistent" | "conflict" | "invalid";
  conflictWith: string[];
};

/** 纯函数去重：只合并同段同位置且没有字段冲突的原文，不做语义猜测。 */
export function deduplicateBoundaryEvidence(
  bundle: ReturnType<typeof buildBoundaryEvidenceBundle>
) {
  const positions = new Map<string, BoundaryEvidence[]>();
  for (const evidence of bundle.evidence) {
    const row = evidence.row;
    const position = pointKeys.has(evidence.kind)
      ? [
          row.atSec,
          evidence.kind === "audioCue"
            ? row.kind
            : evidence.kind === "keyMoment"
              ? row.kindZh
              : null,
        ]
      : evidence.kind === "audioTrack"
        ? [row.fromSec, row.toSec]
        : [row.startSec, row.endSec];
    // 非法位置保留独立身份，不能把所有缺秒记录合成同一条。
    const key = evidence.issues.length
      ? evidence.id
      : sha({ kind: evidence.kind, segment: evidence.segmentIndex, position });
    positions.set(key, [...(positions.get(key) || []), evidence]);
  }
  const units: BoundaryFactUnit[] = [];
  for (const group of Array.from(positions.values())) {
    const variants = new Map<string, BoundaryEvidence[]>();
    for (const evidence of group)
      variants.set(evidence.exactGroup, [
        ...(variants.get(evidence.exactGroup) || []),
        evidence,
      ]);
    const differing = new Set<string>();
    const merged: Row = {};
    for (const source of group)
      for (const [key, value] of Object.entries(source.row)) {
        if (
          Object.prototype.hasOwnProperty.call(merged, key) &&
          canonical(merged[key]) !== canonical(value)
        )
          differing.add(key);
        else merged[key] = copy(value);
      }
    const partitions = differing.size ? Array.from(variants.values()) : [group];
    const next = partitions.map(part => {
      const row = differing.size ? copy(part[0]!.row) : copy(merged);
      const sourceIds = part.map(source => source.id).sort();
      return {
        id: `u_${sha({ source: bundle.sourceDigest, kind: part[0]!.kind, segment: part[0]!.segmentIndex, row }).slice(0, 24)}`,
        kind: part[0]!.kind,
        segmentIndex: part[0]!.segmentIndex,
        row,
        sourceIds,
        status: part.some(source => source.issues.length)
          ? ("invalid" as const)
          : differing.size
            ? ("conflict" as const)
            : ("consistent" as const),
        conflictWith: [] as string[],
      };
    });
    for (const unit of next)
      unit.conflictWith = next
        .filter(other => other.id !== unit.id)
        .map(other => other.id);
    units.push(...next);
  }
  // 不同稿在同一片段交叉覆盖但边界不同，也保留为冲突候选，不延长或重切区间。
  const shots = units.filter(
    unit => unit.kind === "shot" && unit.status !== "invalid"
  );
  for (let a = 0; a < shots.length; a++)
    for (let b = a + 1; b < shots.length; b++) {
      const left = shots[a]!,
        right = shots[b]!;
      if (left.segmentIndex !== right.segmentIndex) continue;
      const overlap =
        Math.min(Number(left.row.endSec), Number(right.row.endSec)) -
        Math.max(Number(left.row.startSec), Number(right.row.startSec));
      if (overlap <= 1e-6) continue;
      left.status = "conflict";
      right.status = "conflict";
      if (!left.conflictWith.includes(right.id))
        left.conflictWith.push(right.id);
      if (!right.conflictWith.includes(left.id))
        right.conflictWith.push(left.id);
    }
  const accounted = new Set(units.flatMap(unit => unit.sourceIds));
  if (accounted.size !== bundle.evidence.length)
    throw new Error("函数去重后存在来源丢失或重复身份");
  return {
    sourceDigest: bundle.sourceDigest,
    units,
    factsSha256: sha(units),
    stats: {
      inputRecords: bundle.evidence.length,
      outputUnits: units.length,
      mergedRecords: bundle.evidence.length - units.length,
      conflictUnits: units.filter(unit => unit.status === "conflict").length,
      invalidUnits: units.filter(unit => unit.status === "invalid").length,
      missingSourceIds: bundle.evidence
        .filter(row => !accounted.has(row.id))
        .map(row => row.id),
    },
  };
}

/** 将纯函数结果还原成原有整形输入；冲突完整旁存，不让模型猜一个版本。 */
export function buildBoundaryCleanStructuringInput(
  bundle: ReturnType<typeof buildBoundaryEvidenceBundle>,
  facts: ReturnType<typeof deduplicateBoundaryEvidence>
) {
  if (
    facts.sourceDigest !== bundle.sourceDigest ||
    facts.factsSha256 !== sha(facts.units)
  )
    throw new Error("函数事实包身份不一致");
  const evidence = new Map(bundle.evidence.map(e => [e.id, e]));
  const output: Row = {
    shots: [],
    keyMoments: [],
    subtitles: [],
    audioResolution: [],
    _unresolvedEvidence: [],
  };
  const unresolved = output._unresolvedEvidence as Row[];
  const rowOf = (u: BoundaryFactUnit): Row => ({
    ...copy(u.row),
    _sourceIds: [...u.sourceIds],
  });
  const defer = (u: BoundaryFactUnit, reasonZh: string) =>
    unresolved.push({
      sourceIds: u.sourceIds,
      reasonZh,
      unitId: u.id,
      kind: u.kind,
      segmentIndex: u.segmentIndex,
      row: copy(u.row),
      conflictWith: u.conflictWith,
    });
  const tracks = new Map<string, Row>();
  const chunks = new Map<number, Row>();
  for (const u of facts.units) {
    if (u.status !== "consistent") {
      defer(
        u,
        u.status === "invalid"
          ? "原始记录存在时间、所属分片或内容问题"
          : "同位置的不同观察或交叉边界未能确定性消解"
      );
      continue;
    }
    if (u.kind === "audioCue") continue;
    const row = rowOf(u);
    if (u.kind === "audioTrack") {
      if (!chunks.has(u.segmentIndex))
        chunks.set(u.segmentIndex, {
          chunkIndex: u.segmentIndex,
          analysis: { audioTrack: [] },
        });
      row.cues = [];
      ((chunks.get(u.segmentIndex)!.analysis as Row).audioTrack as Row[]).push(
        row
      );
      for (const id of u.sourceIds) tracks.set(id, row);
    } else
      (
        output[
          u.kind === "shot"
            ? "shots"
            : u.kind === "keyMoment"
              ? "keyMoments"
              : "subtitles"
        ] as Row[]
      ).push(row);
  }
  for (const u of facts.units.filter(
    u => u.kind === "audioCue" && u.status === "consistent"
  )) {
    const parents = new Set<Row>();
    for (const id of u.sourceIds) {
      const e = evidence.get(id)!;
      const parent = bundle.evidence.find(
        p =>
          p.kind === "audioTrack" &&
          p.segmentIndex === e.segmentIndex &&
          p.attemptNumber === e.attemptNumber &&
          p.path === e.path.replace(/\.cues\[\d+\]$/, "")
      );
      if (parent && tracks.has(parent.id)) parents.add(tracks.get(parent.id)!);
    }
    if (parents.size !== 1) {
      defer(u, "声音事件所属音轨存在冲突或缺失，保留原始关系待复核");
      continue;
    }
    (Array.from(parents)[0]!.cues as Row[]).push(rowOf(u));
  }
  output.audioResolution = Array.from(chunks.values()).sort(
    (a, b) => Number(a.chunkIndex) - Number(b.chunkIndex)
  );
  for (const key of ["shots", "keyMoments", "subtitles"])
    (output[key] as Row[]).sort(
      (a, b) => Number(a.startSec ?? a.atSec) - Number(b.startSec ?? b.atSec)
    );
  output._sourceContext = bundle.annotated.map(raw => {
    const { shots, keyMoments, subtitles, audioResolution, ...context } = raw;
    return {
      ...context,
      audioChunkContext: rows(audioResolution).map(chunk => {
        const { analysis, ...meta } = chunk;
        const { audioTrack, ...rest } = record(analysis) ? analysis : {};
        return { ...meta, analysis: rest };
      }),
    };
  });
  output._functionDedup = {
    sourceDigest: facts.sourceDigest,
    factsSha256: facts.factsSha256,
    ...facts.stats,
  };
  const audit = auditBoundaryEvidenceOutput(bundle, output);
  if (!audit.traceabilityPassed)
    throw new Error("函数整形适配丢失来源或改写事实：" + JSON.stringify(audit));
  return { raw: output, audit };
}

/** 四片一次整形：单稿原样保留，仅同片的重试稿进入函数。 */
export function prepareBoundaryStructuringBatch(
  bundle: ReturnType<typeof buildBoundaryEvidenceBundle>
) {
  const segmentIds = Array.from(
    new Set(bundle.evidence.map(e => e.segmentIndex))
  ).sort((a, b) => a - b);
  const rawSegments: Row[] = [];
  const processed: Array<{
    segmentIndex: number;
    facts: ReturnType<typeof deduplicateBoundaryEvidence>;
    input: ReturnType<typeof buildBoundaryCleanStructuringInput>;
  }> = [];
  for (const segmentIndex of segmentIds) {
    const annotated = bundle.annotated.filter(
      raw => (raw._sourceAttempt as Row).segmentIndex === segmentIndex
    );
    if (annotated.length === 1) {
      // 只有来源追踪元数据，事实及原稿所有字段保持不变。
      rawSegments.push(copy(annotated[0]!));
      continue;
    }
    if (annotated.length < 2 || annotated.length > 3)
      throw new Error("同片函数输入必须是两到三份完整稿");
    const segmentBundle = {
      sourceDigest: bundle.sourceDigest,
      annotated,
      evidence: bundle.evidence.filter(e => e.segmentIndex === segmentIndex),
    };
    const facts = deduplicateBoundaryEvidence(segmentBundle);
    const input = buildBoundaryCleanStructuringInput(segmentBundle, facts);
    rawSegments.push(input.raw);
    processed.push({ segmentIndex, facts, input });
  }
  return {
    rawSegments,
    processed,
    unchangedSegments: segmentIds.filter(
      id => !processed.some(p => p.segmentIndex === id)
    ),
  };
}
