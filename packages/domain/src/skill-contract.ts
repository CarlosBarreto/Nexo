import type {
  SkillContract,
  SkillFieldSpec,
  SkillFieldType,
} from "@nexo/protocol";
import { parse as parseToml } from "smol-toml";
import { skillDirKey } from "./skills";
import type { DocDiagnostic, TextStore } from "./store";

/**
 * Skill contracts (Axie contract-first skills): an optional `contract.toml`
 * beside SKILL.md declaring typed input/output fields plus security
 * constraints. Parsed + validated at authoring time (the host 400s an invalid
 * one); `validateSkillInput` enforces the contract against a structured
 * payload at execution time. TOML keys are snake_case on disk
 * (max_length, forbid_prompt_injection) and normalize to the camelCase
 * protocol shape here.
 */

export const contractKey = (root: string, slug: string) =>
  `${skillDirKey(root, slug)}/contract.toml`;

const FIELD_TYPES: SkillFieldType[] = ["string", "number", "boolean", "array"];

const MAX_TIMEOUT_SECONDS = 600;

/**
 * Conservative prompt-injection tells. The goal is catching the obvious
 * override attempts riding on structured inputs, not an arms race — anything
 * subtler is the model's own guard rails' job.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|earlier|above)\s+(?:instructions|rules|prompts)/i,
  /disregard\s+(?:the|your|all)\s+(?:system\s+prompt|instructions|rules)/i,
  /forget\s+(?:everything|all)\s+(?:you\s+(?:know|were\s+told)|above|before)/i,
  /reveal\s+(?:the|your)\s+(?:system\s+prompt|hidden\s+instructions)/i,
];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** One field spec ([input.foo] / [output.bar] table), or the reason it is invalid. */
function parseFieldSpec(
  path: string,
  raw: unknown,
): { spec: SkillFieldSpec } | { error: string } {
  if (!isRecord(raw)) return { error: `${path} is not a table` };
  const type = raw.type;
  if (typeof type !== "string" || !FIELD_TYPES.includes(type as SkillFieldType))
    return {
      error: `${path}.type must be one of ${FIELD_TYPES.join(", ")}`,
    };
  const spec: SkillFieldSpec = { type: type as SkillFieldType };
  if (raw.required !== undefined) {
    if (typeof raw.required !== "boolean")
      return { error: `${path}.required must be a boolean` };
    spec.required = raw.required;
  }
  if (raw.max_length !== undefined) {
    if (spec.type !== "string")
      return { error: `${path}.max_length only applies to string fields` };
    if (typeof raw.max_length !== "number" || raw.max_length < 1)
      return { error: `${path}.max_length must be a positive number` };
    spec.maxLength = raw.max_length;
  }
  if (raw.items !== undefined) {
    if (spec.type !== "array")
      return { error: `${path}.items only applies to array fields` };
    if (
      typeof raw.items !== "string" ||
      raw.items === "array" ||
      !FIELD_TYPES.includes(raw.items as SkillFieldType)
    )
      return { error: `${path}.items must be string, number, or boolean` };
    spec.items = raw.items as Exclude<SkillFieldType, "array">;
  }
  return { spec };
}

function parseFieldTable(
  section: "input" | "output",
  raw: unknown,
): { fields: Record<string, SkillFieldSpec> } | { error: string } {
  if (raw === undefined) return { fields: {} };
  if (!isRecord(raw)) return { error: `[${section}] is not a table` };
  const fields: Record<string, SkillFieldSpec> = {};
  for (const [name, value] of Object.entries(raw)) {
    const parsed = parseFieldSpec(`${section}.${name}`, value);
    if ("error" in parsed) return parsed;
    fields[name] = parsed.spec;
  }
  return { fields };
}

/**
 * Parse + structurally validate a contract.toml. The contract's `skill.name`
 * must equal the directory slug — the slug is the skill's identity everywhere
 * else (HOU-515), so a drifting contract name must not create a second one.
 */
export function parseSkillContract(
  slug: string,
  toml: string,
): { contract: SkillContract } | { error: string } {
  let raw: unknown;
  try {
    raw = parseToml(toml);
  } catch (err) {
    return {
      error: `contract.toml is not valid TOML: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!isRecord(raw)) return { error: "contract.toml is not a table" };
  const skill = raw.skill;
  if (!isRecord(skill)) return { error: "missing [skill] table" };
  if (typeof skill.name !== "string" || !skill.name)
    return { error: "missing skill.name" };
  if (skill.name !== slug)
    return {
      error: `skill.name '${skill.name}' must match the skill slug '${slug}'`,
    };

  const input = parseFieldTable("input", raw.input);
  if ("error" in input) return input;
  const output = parseFieldTable("output", raw.output);
  if ("error" in output) return output;

  const contract: SkillContract = {
    skill: {
      name: skill.name,
      ...(typeof skill.description === "string"
        ? { description: skill.description }
        : {}),
      ...(typeof skill.version === "string" ? { version: skill.version } : {}),
    },
    input: input.fields,
    output: output.fields,
  };

  if (raw.judge !== undefined) {
    if (!isRecord(raw.judge)) return { error: "[judge] is not a table" };
    if (typeof raw.judge.enabled !== "boolean")
      return { error: "judge.enabled must be a boolean" };
    if (
      raw.judge.criteria !== undefined &&
      typeof raw.judge.criteria !== "string"
    )
      return { error: "judge.criteria must be a string" };
    contract.judge = {
      enabled: raw.judge.enabled,
      ...(typeof raw.judge.criteria === "string"
        ? { criteria: raw.judge.criteria }
        : {}),
    };
  }

  if (raw.security !== undefined) {
    if (!isRecord(raw.security)) return { error: "[security] is not a table" };
    const security: NonNullable<SkillContract["security"]> = {};
    if (raw.security.forbid_prompt_injection !== undefined) {
      if (typeof raw.security.forbid_prompt_injection !== "boolean")
        return { error: "security.forbid_prompt_injection must be a boolean" };
      security.forbidPromptInjection = raw.security.forbid_prompt_injection;
    }
    if (raw.security.timeout_seconds !== undefined) {
      const t = raw.security.timeout_seconds;
      if (typeof t !== "number" || t < 1 || t > MAX_TIMEOUT_SECONDS)
        return {
          error: `security.timeout_seconds must be between 1 and ${MAX_TIMEOUT_SECONDS}`,
        };
      security.timeoutSeconds = t;
    }
    contract.security = security;
  }

  return { contract };
}

/** The stored contract, or null when the skill declares none. */
export async function loadSkillContract(
  store: TextStore,
  root: string,
  slug: string,
): Promise<{
  contract: SkillContract | null;
  toml: string | null;
  diagnostics: DocDiagnostic[];
}> {
  const key = contractKey(root, slug);
  const toml = await store.readText(key);
  if (toml === null) return { contract: null, toml: null, diagnostics: [] };
  const parsed = parseSkillContract(slug, toml);
  if ("error" in parsed) {
    return {
      contract: null,
      toml,
      diagnostics: [{ key, message: parsed.error }],
    };
  }
  return { contract: parsed.contract, toml, diagnostics: [] };
}

const typeOf = (v: unknown): SkillFieldType | null => {
  if (typeof v === "string") return "string";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (Array.isArray(v)) return "array";
  return null;
};

/**
 * Enforce a contract against a structured input payload. Contract-first:
 * undeclared fields are rejected, not passed through. When the contract sets
 * `forbid_prompt_injection`, every string value (including array elements) is
 * screened against the injection tells.
 */
export function validateSkillInput(
  contract: SkillContract,
  input: Record<string, unknown>,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  for (const [name, spec] of Object.entries(contract.input)) {
    if (spec.required && input[name] === undefined)
      errors.push(`missing required field '${name}'`);
  }

  const strings: { field: string; value: string }[] = [];
  for (const [name, value] of Object.entries(input)) {
    const spec = contract.input[name];
    if (!spec) {
      errors.push(`undeclared field '${name}'`);
      continue;
    }
    const actual = typeOf(value);
    if (actual !== spec.type) {
      errors.push(`field '${name}' must be a ${spec.type}`);
      continue;
    }
    if (spec.type === "string") {
      const s = value as string;
      if (spec.maxLength !== undefined && s.length > spec.maxLength)
        errors.push(
          `field '${name}' exceeds max_length ${spec.maxLength} (${s.length})`,
        );
      strings.push({ field: name, value: s });
    }
    if (spec.type === "array" && spec.items) {
      for (const [i, item] of (value as unknown[]).entries()) {
        if (typeOf(item) !== spec.items) {
          errors.push(`field '${name}[${i}]' must be a ${spec.items}`);
        } else if (spec.items === "string") {
          strings.push({ field: `${name}[${i}]`, value: item as string });
        }
      }
    }
  }

  if (contract.security?.forbidPromptInjection) {
    for (const { field, value } of strings) {
      if (INJECTION_PATTERNS.some((p) => p.test(value)))
        errors.push(`field '${field}' looks like a prompt-injection attempt`);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
