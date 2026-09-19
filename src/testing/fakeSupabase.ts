// An in-memory stand-in for the Supabase client, good enough to render a
// page and nothing more.
//
// Why this exists. Every page in this app is a `force-dynamic` server
// component, so `npm run build` type-checks them and never executes one.
// Nothing in the repo has ever run a page. The prototype is a second
// implementation of the same screens and proves nothing about the real
// ones: it shares the engine modules and none of the page code.
//
// So a whole class of bug had no check anywhere. Reading a field off a
// row that is null, mapping over something that came back as an object
// rather than an array, an embed that arrives as `{...}` on one query and
// `[{...}]` on another: all of them are runtime throws that tsc cannot
// see through an `as` cast, and every one of them is a blank screen.
//
// What this is NOT. It is not PostgREST. It supports the subset of the
// query builder the app actually uses, and it throws loudly on anything
// it does not implement rather than returning an empty result, because a
// silent empty result would make the render pass for the wrong reason.
// Column NAMES are not its job either: src/laws/schemaLaws.test.ts checks
// those against the migrations, which is the authoritative source.
//
// The one behaviour worth calling out is the embed shape. PostgREST
// returns a single object for a many-to-one embed and an array for a
// one-to-many, and the app has a `unwrap()` helper in three files because
// of it. This fake reproduces that difference rather than always
// returning an array, since always returning an array is precisely the
// assumption those helpers exist to survive.

export type Row = Record<string, unknown>;
export type Dataset = Record<string, Row[]>;

// Every write the fake was asked to perform, in order. Rendering a page
// never writes, so for the read harness this stays empty and proves it.
// For the action harness it is the whole point: an action's job is to
// authorize, validate, and then write the right row to the right table
// with the right org_id, and none of that is observable any other way.
export interface RecordedWrite {
  op: "insert" | "update" | "upsert" | "delete";
  table: string;
  rows: Row[];
  // The filters in force when an update or delete ran. An action that
  // forgets `.eq("org_id", ...)` writes across orgs, and the only place
  // that is visible is here.
  filters: Array<{ column: string; value: unknown }>;
  onConflict?: string;
}

// Which embedded name resolves to which table, and whether it comes back
// as one row or many. Taken from the foreign keys in migrations/, so a
// join the app writes and the schema does not have is a loud failure
// here rather than an empty object.
interface EmbedSpec {
  table: string;
  // The column on the CHILD side that points at the parent row.
  foreignKey: string;
  // many-to-one arrives as an object; one-to-many as an array.
  many: boolean;
}

const EMBEDS: Record<string, Record<string, EmbedSpec>> = {
  recruiting_targets: {
    athletes: { table: "athletes", foreignKey: "athlete_id", many: false },
    schools: { table: "schools", foreignKey: "school_id", many: false },
  },
  org_members: {
    users: { table: "users", foreignKey: "user_id", many: false },
  },
  ncaa_approved_course_lists: {
    ncaa_approved_courses: { table: "ncaa_approved_courses", foreignKey: "list_id", many: true },
  },
  org_approved_course_lists: {
    org_approved_courses: { table: "org_approved_courses", foreignKey: "list_id", many: true },
  },
  documents: {
    athletes: { table: "athletes", foreignKey: "athlete_id", many: false },
  },
  board_members: {
    boards: { table: "boards", foreignKey: "board_id", many: false },
    donors: { table: "donors", foreignKey: "donor_id", many: false },
  },
  gifts: {
    donors: { table: "donors", foreignKey: "donor_id", many: false },
    campaigns: { table: "campaigns", foreignKey: "campaign_id", many: false },
  },
  pledges: {
    donors: { table: "donors", foreignKey: "donor_id", many: false },
    campaigns: { table: "campaigns", foreignKey: "campaign_id", many: false },
  },
  contacts: {
    schools: { table: "schools", foreignKey: "school_id", many: false },
  },
  athlete_courses: {
    athletes: { table: "athletes", foreignKey: "athlete_id", many: false },
  },
};

interface Filter {
  kind: "eq" | "is" | "in" | "neq" | "not";
  column: string;
  value: unknown;
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

export class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Filter[] = [];
  private selectList = "*";
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitTo: number | null = null;
  private wantsSingle: "single" | "maybe" | null = null;
  private writes: { op: "insert" | "update" | "upsert" | "delete"; values?: Row | Row[]; onConflict?: string } | null = null;

  constructor(
    private data: Dataset,
    private table: string,
    private onUnsupported: (what: string) => never,
    private recorded: RecordedWrite[],
    private failOn: (table: string, op: string) => string | null,
  ) {}

  select(list?: string) {
    if (list) this.selectList = list;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push({ kind: "neq", column, value });
    return this;
  }
  is(column: string, value: unknown) {
    this.filters.push({ kind: "is", column, value });
    return this;
  }
  in(column: string, value: unknown[]) {
    this.filters.push({ kind: "in", column, value });
    return this;
  }
  not(column: string, _op: string, value: unknown) {
    this.filters.push({ kind: "not", column, value });
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.limitTo = n;
    return this;
  }
  single() {
    this.wantsSingle = "single";
    return this;
  }
  maybeSingle() {
    this.wantsSingle = "maybe";
    return this;
  }
  insert(values: Row | Row[]) {
    this.writes = { op: "insert", values };
    return this;
  }
  update(values: Row) {
    this.writes = { op: "update", values };
    return this;
  }
  upsert(values: Row | Row[], opts?: { onConflict?: string }) {
    this.writes = { op: "upsert", values, onConflict: opts?.onConflict };
    return this;
  }
  delete() {
    this.writes = { op: "delete" };
    return this;
  }
  or(): never {
    return this.onUnsupported(`.or() on ${this.table}`);
  }
  ilike(): never {
    return this.onUnsupported(`.ilike() on ${this.table}`);
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      const v = row[f.column];
      if (f.kind === "eq") return v === f.value;
      if (f.kind === "neq") return v !== f.value;
      if (f.kind === "is") return f.value === null ? v === null || v === undefined : v === f.value;
      if (f.kind === "in") return (f.value as unknown[]).includes(v);
      if (f.kind === "not") return v !== f.value;
      return true;
    });
  }

  private project(row: Row): Row {
    if (this.selectList.trim() === "*") return { ...row };
    const out: Row = {};
    for (const part of splitTop(this.selectList)) {
      const embed = part.match(/^(\w+)\s*(?:!\w+)?\s*\(([\s\S]*)\)$/);
      if (embed) {
        const spec = EMBEDS[this.table]?.[embed[1]];
        if (!spec) this.onUnsupported(`embed "${embed[1]}" on ${this.table} has no foreign key in the fake's EMBEDS map`);
        const child = this.data[spec.table] ?? [];
        // A many-to-one embed joins on THIS row's column; a one-to-many
        // joins on the child's.
        const related = spec.many
          ? child.filter((c) => c[spec.foreignKey] === row.id)
          : child.filter((c) => c.id === row[spec.foreignKey]);
        const inner = related.map((c) => {
          const q = new FakeQuery(this.data, spec.table, this.onUnsupported, this.recorded, this.failOn);
          q.selectList = embed[2];
          return q.project(c);
        });
        out[embed[1]] = spec.many ? inner : (inner[0] ?? null);
        continue;
      }
      const name = part.replace(/^\w+\s*:\s*/, "").trim();
      if (!/^\w+$/.test(name)) continue;
      out[name] = row[name] ?? null;
    }
    return out;
  }

  private run(): { data: unknown; error: unknown } {
    const table = this.data[this.table];
    if (!table) this.onUnsupported(`table "${this.table}" is not in the fixture`);

    if (this.writes) {
      const forced = this.failOn(this.table, this.writes.op);
      if (forced) return { data: null, error: { message: forced } };

      const values = this.writes.values;
      const rows = values === undefined ? [] : Array.isArray(values) ? values : [values];
      this.recorded.push({
        op: this.writes.op,
        table: this.table,
        rows,
        filters: this.filters.map((f) => ({ column: f.column, value: f.value })),
        onConflict: this.writes.onConflict,
      });

      // The row is written into the dataset so that a chained
      // `.select().single()` gets something back, which several actions
      // rely on to learn the new row's id. An id is minted here when the
      // caller did not supply one, the way a default would.
      const inserted: Row[] = [];
      if (this.writes.op !== "delete") {
        for (const r of rows) {
          const row = { id: r.id ?? `fake-${this.table}-${table.length + inserted.length + 1}`, ...r };
          table.push(row);
          inserted.push(row);
        }
      }

      if (this.wantsSingle) {
        const one = inserted[0] ?? null;
        return { data: one ? this.project(one) : null, error: null };
      }
      return { data: inserted.map((r) => this.project(r)), error: null };
    }

    let rows = table.filter((r) => this.matches(r));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) => {
        const x = a[column];
        const y = b[column];
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (x < y ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    if (this.limitTo !== null) rows = rows.slice(0, this.limitTo);

    const projected = rows.map((r) => this.project(r));

    if (this.wantsSingle) {
      if (projected.length === 1) return { data: projected[0], error: null };
      if (this.wantsSingle === "maybe" && projected.length === 0) return { data: null, error: null };
      return { data: null, error: { message: `expected one row from ${this.table}, got ${projected.length}` } };
    }
    return { data: projected, error: null };
  }

  then<R1 = { data: unknown; error: unknown }, R2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export interface FakeClientOptions {
  // The signed-in user. Null renders the signed-out path.
  userId: string | null;
  // Collects every write. Pass one in to assert on what an action did.
  recorded?: RecordedWrite[];
  // Force a database error on one table and operation, so the error
  // branch of an action is reachable. Every action has one and none of
  // them had ever run.
  failOn?: (table: string, op: string) => string | null;
}

export function createFakeClient(data: Dataset, opts: FakeClientOptions) {
  const unsupported = (what: string): never => {
    // Loud rather than empty. An unimplemented builder method returning
    // no rows would make a page render blank and the test pass, which is
    // the failure mode this whole harness exists to avoid.
    throw new Error(`fakeSupabase does not implement: ${what}`);
  };

  const recorded = opts.recorded ?? [];
  const failOn = opts.failOn ?? (() => null);

  return {
    from(table: string) {
      return new FakeQuery(data, table, unsupported, recorded, failOn);
    },
    auth: {
      async getUser() {
        return { data: { user: opts.userId ? { id: opts.userId } : null }, error: null };
      },
    },
    // Storage, just far enough for the documents flow. Objects live in a
    // `storage_objects` table of the fixture as { bucket, name, base64 };
    // a download hands back a Blob the way the real client does, and an
    // upload is recorded like any other write so a test can see the path
    // an action put a file at.
    storage: {
      from(bucket: string) {
        return {
          async download(path: string) {
            const objects = data.storage_objects ?? [];
            const found = objects.find((o) => o.bucket === bucket && o.name === path);
            if (!found) return { data: null, error: { message: `Object not found: ${bucket}/${path}` } };
            const bytes = Buffer.from(String(found.base64), "base64");
            return { data: new Blob([bytes]), error: null };
          },
          async upload(path: string, _body: unknown, options?: { contentType?: string }) {
            recorded.push({ op: "insert", table: `storage:${bucket}`, rows: [{ name: path, contentType: options?.contentType ?? null }], filters: [] });
            return { data: { path }, error: null };
          },
        };
      },
    },
  };
}
