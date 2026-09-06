import {
  auditBoundaryEvidenceOutput,
  prepareBoundaryStructuringBatch,
  type buildBoundaryEvidenceBundle,
} from "./manhuaNativeBoundaryExperiment.js";

type Row = Record<string, unknown>;
type Bundle = ReturnType<typeof buildBoundaryEvidenceBundle>;
type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  anyOf?: Schema[];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minLength?: number;
  maxLength?: number;
  [key: string]: unknown;
};
const object = (v: unknown): v is Row =>
  !!v && typeof v === "object" && !Array.isArray(v);
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical)}]`
    : object(v)
      ? `{${Object.keys(v)
          .sort()
          .map(k => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : (JSON.stringify(v) ?? "null");
const arr = (v: unknown): Row[] => (Array.isArray(v) ? v.filter(object) : []);
const nonempty: Schema = { type: "string", minLength: 1 };
const ids: Schema = {
  type: "array",
  items: nonempty,
  minItems: 1,
  uniqueItems: true,
};
const obj = (
  properties: Record<string, Schema>,
  required = Object.keys(properties)
): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

/** 原稿字段由真实输入推导，允许保留越界原值，不用正文限制截断失败证据。 */
function originalSchema(values: unknown[]): Schema {
  const types = Array.from(
    new Set(
      values.map(v =>
        v === null ? "null" : Array.isArray(v) ? "array" : typeof v
      )
    )
  );
  if (types.length > 1)
    return {
      anyOf: types.map(t =>
        originalSchema(
          values.filter(
            v =>
              (v === null ? "null" : Array.isArray(v) ? "array" : typeof v) ===
              t
          )
        )
      ),
    };
  if (types[0] === "object") {
    const records = values as Row[];
    return obj(
      Object.fromEntries(
        Array.from(new Set(records.flatMap(v => Object.keys(v)))).map(k => [
          k,
          originalSchema(records.filter(v => k in v).map(v => v[k])),
        ])
      ),
      []
    );
  }
  if (types[0] === "array") {
    const items = values.flatMap(v => v as unknown[]);
    return {
      type: "array",
      items: items.length ? originalSchema(items) : { type: "string" },
    };
  }
  return { type: types[0] || "null" };
}

/** 仅校验本契约生成的标准JSON Schema子集，不做修复或字段过滤。 */
function validate(schema: Schema, value: unknown, path = "$root"): void {
  const fail = () => {
    throw new Error(`冲突schema不符：${path}`);
  };
  if (schema.anyOf) {
    if (
      !schema.anyOf.some(s => {
        try {
          validate(s, value, path);
          return true;
        } catch {
          return false;
        }
      })
    )
      fail();
    return;
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual =
    value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (
    !types.some(
      t =>
        t === actual ||
        (t === "integer" &&
          typeof value === "number" &&
          Number.isInteger(value))
    )
  )
    fail();
  if (typeof value === "number" && !Number.isFinite(value)) fail();
  if (schema.enum && !schema.enum.some(v => canonical(v) === canonical(value)))
    fail();
  if (
    typeof value === "string" &&
    ((schema.minLength &&
      (!value.trim() || Array.from(value).length < schema.minLength)) ||
      (schema.maxLength !== undefined &&
        Array.from(value).length > schema.maxLength))
  )
    fail();
  if (Array.isArray(value)) {
    if (
      value.length < (schema.minItems ?? 0) ||
      value.length > (schema.maxItems ?? Infinity)
    )
      fail();
    if (
      schema.uniqueItems &&
      new Set(value.map(canonical)).size !== value.length
    )
      fail();
    value.forEach((v, i) => validate(schema.items!, v, `${path}[${i}]`));
  }
  if (object(value)) {
    for (const key of schema.required || [])
      if (!(key in value))
        throw new Error(`冲突schema缺少字段：${path}.${key}`);
    for (const [key, v] of Object.entries(value)) {
      const child = schema.properties?.[key];
      if (child) validate(child, v, `${path}.${key}`);
      else if (schema.additionalProperties === false) fail();
    }
  }
}

export function buildBoundaryStructuringContract(
  base: Record<string, unknown>,
  bundle: Bundle
) {
  if (!bundle.evidence.length) throw new Error("冲突契约缺少真实来源");
  const schema = structuredClone(base) as Schema;
  const props = schema.properties!;
  const rawSchema = originalSchema(bundle.evidence.map(e => e.row));
  const alternatives = {
    type: "array",
    items: obj({ sourceId: nonempty, fields: rawSchema }),
  } satisfies Schema;
  const addSource = (s: Schema) => {
    s.properties!._sourceIds = ids;
    s.properties!._sourceAlternatives = alternatives;
    s.required = Array.from(
      new Set([...(s.required || []), "_sourceIds", "_sourceAlternatives"])
    );
  };
  ["shots", "keyMoments", "subtitles"].forEach(k =>
    addSource(props[k]!.items!)
  );
  const track =
    props.audioResolution!.items!.properties!.analysis!.properties!.audioTrack!
      .items!;
  addSource(track);
  addSource(track.properties!.cues!.items!);
  props._unresolvedEvidence = {
    type: "array",
    items: obj({ sourceIds: ids, reasonZh: nonempty, row: rawSchema }),
  };
  const batch = prepareBoundaryStructuringBatch(bundle);
  const pending = batch.processed.flatMap(p =>
    arr(p.input.raw._unresolvedEvidence)
  );
  // 连通的候选形成同一冲突组，避免要求模型为每条原稿重复解释。
  const byId = new Map(
    batch.processed.flatMap(p => p.facts.units).map(u => [u.id, u])
  );
  const seen = new Set<string>();
  const groups: Array<{ groupId: string; sourceIds: string[] }> = [];
  for (const item of pending) {
    const start = String(item.unitId);
    if (seen.has(start)) continue;
    const queue = [start],
      sources = new Set<string>();
    while (queue.length) {
      const id = queue.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const unit = byId.get(id)!;
      unit.sourceIds.forEach(s => sources.add(s));
      queue.push(...unit.conflictWith);
    }
    groups.push({
      groupId: `conflict_${groups.length + 1}`,
      sourceIds: Array.from(sources).sort(),
    });
  }
  props._conflictResolutions = {
    type: "array",
    minItems: groups.length,
    maxItems: groups.length,
    items: obj({
      groupId: nonempty,
      sourceIds: ids,
      status: { type: "string", enum: ["resolved", "unresolved"] },
      selectedSourceIds: { type: "array", items: nonempty, uniqueItems: true },
      reasonZh: nonempty,
    }),
  };
  schema.required = Array.from(
    new Set([
      ...(schema.required || []),
      "_unresolvedEvidence",
      "_conflictResolutions",
    ])
  );
  const instruction = `\n【多稿冲突强制输出契约v1】继续完整整形。每条镜头、重点、字幕、音轨和事件必须输出_sourceIds与_sourceAlternatives（无替代观察时为空数组）。兼容字段保持原文，未进入主字段的原文放_sourceAlternatives的sourceId与fields。每个冲突组必须在_conflictResolutions返回groupId、完整sourceIds、status、selectedSourceIds、reasonZh。只有有原文依据的取舍才标resolved，并引用实际进入正文的selectedSourceIds；仍有任何候选无法确定则标unresolved，selectedSourceIds仅列已能确认进入正文的部分。未解决来源逐项放_unresolvedEvidence，必须带sourceIds、reasonZh及原始row，不能只列编号。所有来源及不同原文字段均须在正文、替代观察或未解决项对账。时间起止必须来自同一原稿，不拼接区间，不补造事实。不得以门禁通过状态代替事实判断。冲突组：${JSON.stringify(groups)}`;
  return {
    schema: schema as Record<string, unknown>,
    instruction,
    groups,
    validate(output: Row) {
      validate(schema, output);
      const audit = auditBoundaryEvidenceOutput(bundle, output);
      if (!audit.traceabilityPassed)
        throw new Error("冲突来源对账失败：" + JSON.stringify(audit));
      const index = new Map(bundle.evidence.map(e => [e.id, e]));
      const unresolved = new Set<string>();
      for (const item of arr(output._unresolvedEvidence)) {
        const row = item.row as Row;
        for (const id of item.sourceIds as string[]) {
          unresolved.add(id);
          const original = index.get(id)!;
          if (
            !Object.entries(original.row).every(
              ([k, v]) => canonical(row[k]) === canonical(v)
            ) ||
            !Object.entries(row).every(([k, v]) =>
              (item.sourceIds as string[]).some(
                s => canonical(index.get(s)?.row[k]) === canonical(v)
              )
            )
          )
            throw new Error("未解决证据原文被修改或遗漏：" + id);
        }
      }
      const used = new Set<string>();
      const collect = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(collect);
        else if (object(v)) {
          if (Array.isArray(v._sourceIds))
            v._sourceIds.forEach(id => used.add(String(id)));
          Object.entries(v)
            .filter(([k]) => !k.startsWith("_"))
            .forEach(([, x]) => collect(x));
        }
      };
      collect(output);
      const resolutions = arr(output._conflictResolutions);
      if (new Set(resolutions.map(r => r.groupId)).size !== groups.length)
        throw new Error("冲突组重复或遗漏");
      for (const group of groups) {
        const r = resolutions.find(r => r.groupId === group.groupId);
        if (
          !r ||
          canonical([...(r.sourceIds as string[])].sort()) !==
            canonical(group.sourceIds)
        )
          throw new Error("冲突组来源不闭合");
        const selected = r.selectedSourceIds as string[];
        if (
          selected.some(
            id =>
              !group.sourceIds.includes(id) ||
              !used.has(id) ||
              unresolved.has(id)
          )
        )
          throw new Error("冲突选用结果没有对应正文");
        const stillUnresolved = group.sourceIds.some(id => unresolved.has(id));
        if (
          (r.status === "resolved" && (!selected.length || stillUnresolved)) ||
          (r.status === "unresolved" && !stillUnresolved)
        )
          throw new Error("冲突处理状态与实际结果矛盾");
      }
    },
  };
}
