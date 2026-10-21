/**
 * Bulk-upload column config shared by every master import (customers, transporters, loading
 * points, products, contracts). Each master declares its sheet once as ImportColumn[]; the
 * downloadable template (sample.ts) and the upload parser (parse.ts) both read that list, so a
 * template can't drift from what its import accepts.
 */

export type ImportColumnKind =
  'text' | 'number' | 'integer' | 'yesno' | 'enum' | 'date' | 'time' | 'custom';

/**
 * Where a cell lands in the create payload:
 * - `{ field }` — a top-level field;
 * - `{ group, index, field }` — one slot of a repeated group (contacts[0].phone); blank slots
 *   are dropped and the rest compacted;
 * - `{ object, field }` — a nested object (truckType.bodyType), dropped when all blank.
 */
export type ImportTarget =
  | { field: string }
  | { group: string; index: number; field: string }
  | { object: string; field: string };

export interface ImportOption {
  label: string;
  value: string;
}

export interface ImportColumn {
  key: string;
  header: string;
  kind: ImportColumnKind;
  target: ImportTarget;
  /** 'group' = required once any cell of its group is filled; 'one-of' = see requiredNote. */
  required: 'yes' | 'no' | 'group' | 'one-of';
  requiredNote?: string;
  format: string;
  example?: string | number;
  /** Normalised (see normalizeHeader) alternative headers, besides the header and key. */
  aliases?: string[];
  /** Dropdown in the template; an enum cell matching a label or value maps to the value. */
  options?: ImportOption[];
  /** Dropdown fed from a list passed when the template is built (e.g. this tenant's
   *  transporters), written to a hidden sheet. */
  listSource?: string;
  /** Overrides the kind's parsing of a non-blank, trimmed cell. */
  parse?: (raw: string) => unknown;
  /** kind 'custom': writes the cell into the row draft itself (legacy combined columns). */
  apply?: (draft: Record<string, unknown>, raw: string) => void;
  /** false = read on upload for older sheets, but not written to the template. */
  inTemplate: boolean;
}

export function normalizeHeader(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

/** "Original POD" → the option's value, by label or value; anything else passes through for the
 *  validator to reject with its own message. */
export function optionValue(options: ImportOption[], raw: string): string {
  const normalized = normalizeHeader(raw);
  const match = options.find(
    (option) =>
      normalizeHeader(option.label) === normalized || normalizeHeader(option.value) === normalized,
  );
  return match ? match.value : raw;
}

/** Enum values → dropdown options with readable labels ("private_limited" → "Private limited"). */
export function enumOptions(
  values: readonly string[],
  labels: Partial<Record<string, string>> = {},
): ImportOption[] {
  return values.map((value) => ({
    value,
    label: labels[value] ?? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' '),
  }));
}

/** Normalised header → column. A header claimed by two columns is a config bug, caught here. */
export function buildHeaderIndex(columns: ImportColumn[]): ReadonlyMap<string, ImportColumn> {
  const map = new Map<string, ImportColumn>();
  for (const column of columns) {
    for (const alias of [
      normalizeHeader(column.header),
      normalizeHeader(column.key),
      ...(column.aliases ?? []),
    ]) {
      const existing = map.get(alias);
      if (existing && existing !== column)
        throw new Error(`Import header "${alias}" maps to both ${existing.key} and ${column.key}`);
      map.set(alias, column);
    }
  }
  return map;
}

/** Template header shown to users — required columns carry a trailing " *". */
export function templateHeader(column: ImportColumn): string {
  return column.required === 'yes' ? `${column.header} *` : column.header;
}

/** A payload path ("contacts.1.phone", "truckType.bodyType", "name") → its sheet header. */
export function headerForPath(columns: ImportColumn[], path: string): string {
  const [first, second, third] = path.split('.');
  const column = columns.find(({ target }) => {
    if ('group' in target)
      return target.group === first && String(target.index) === second && target.field === third;
    if ('object' in target) return target.object === first && target.field === second;
    return target.field === first && second === undefined;
  });
  return column ? column.header : path;
}

export type GroupFieldSpec = Omit<ImportColumn, 'key' | 'header' | 'target' | 'inTemplate'> & {
  field: string;
  label: string;
};

/** Builds the numbered columns of one group slot, e.g. "Contact 2 Phone". Examples are kept only
 *  on the first slot so the sample row shows one filled group. */
export function groupColumns(
  group: string,
  index: number,
  labelPrefix: string,
  fields: GroupFieldSpec[],
): ImportColumn[] {
  const n = index + 1;
  return fields.map(({ field, label, example, ...rest }) => ({
    ...rest,
    key: `${group}${n}${field.charAt(0).toUpperCase()}${field.slice(1)}`,
    header: `${labelPrefix} ${n} ${label}`,
    target: { group, index, field },
    example: index === 0 ? example : undefined,
    inTemplate: true,
  }));
}

export type ColumnSpec = Omit<ImportColumn, 'target' | 'inTemplate'> & { field: string };

/** A top-level template column. */
export function topColumn({ field, ...spec }: ColumnSpec): ImportColumn {
  return { ...spec, target: { field }, inTemplate: true };
}

/** A template column inside a nested object payload field (e.g. truckType.bodyType). */
export function objectColumn(object: string, { field, ...spec }: ColumnSpec): ImportColumn {
  return { ...spec, target: { object, field }, inTemplate: true };
}

/** An upload-only column kept so older sheets (and re-uploaded exports) still import. */
export function legacyColumn({
  field,
  ...spec
}: Omit<ColumnSpec, 'header' | 'required' | 'format'>): ImportColumn {
  return {
    ...spec,
    header: spec.key,
    required: 'no',
    format: 'Legacy column',
    target: { field },
    inTemplate: false,
  };
}

/** Same groups repeated `count` times, e.g. Contact 1…2. */
export function repeatGroup(
  count: number,
  group: string,
  labelPrefix: string,
  fields: GroupFieldSpec[],
): ImportColumn[] {
  return Array.from({ length: count }, (_, index) =>
    groupColumns(group, index, labelPrefix, fields),
  ).flat();
}

export const YES_NO_OPTIONS: ImportOption[] = [
  { label: 'Yes', value: 'true' },
  { label: 'No', value: 'false' },
];
