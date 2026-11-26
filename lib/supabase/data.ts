import "server-only";

import {
  getSupabaseConfigurationError,
  getSupabaseServerClient,
} from "@/lib/supabase/server";

export const publicTables = [
  "classes",
  "divisions",
  "events",
  "member_standings_riders",
  "public_rider_credits",
  "public_riders",
  "results",
  "seasons",
  "series",
] as const;

export type PublicTable = (typeof publicTables)[number];

export type PublicDataError = {
  kind: "configuration" | "query";
  message: string;
};

export type PublicDataResult<Row> = {
  data: Row[] | null;
  error: PublicDataError | null;
};

export type PublicSelectOptions = {
  orderBy?: string;
  ascending?: boolean;
  limit?: number;
  equals?: {
    column: string;
    value: string | number | boolean;
  };
  /** Only rows whose column is one of these values. An empty list returns no rows. */
  in?: {
    column: string;
    values: (string | number)[];
  };
};

// Supabase returns at most 1000 rows per request, so larger reads are paged.
const PAGE_SIZE = 1000;
// Long `in` lists are split so the request URL stays a reasonable length.
const IN_CHUNK = 150;

export async function selectPublicRows<Row extends Record<string, unknown>>(
  table: PublicTable,
  columns: string,
  options: PublicSelectOptions = {},
): Promise<PublicDataResult<Row>> {
  const client = getSupabaseServerClient();

  if (!client) {
    return {
      data: null,
      error: {
        kind: "configuration",
        message:
          getSupabaseConfigurationError() ??
          "Supabase is not configured. Check the server environment variables.",
      },
    };
  }

  if (options.in && options.in.values.length === 0) {
    return { data: [], error: null };
  }

  const inChunks = options.in
    ? Array.from(
        { length: Math.ceil(options.in.values.length / IN_CHUNK) },
        (_, i) => options.in!.values.slice(i * IN_CHUNK, (i + 1) * IN_CHUNK),
      )
    : [null];

  try {
    const rows: Row[] = [];

    for (const chunk of inChunks) {
      for (let from = 0; ; from += PAGE_SIZE) {
        let query = client.from(table).select(columns);

        if (options.equals) {
          query = query.eq(options.equals.column, options.equals.value);
        }

        if (options.in && chunk) {
          query = query.in(options.in.column, chunk);
        }

        if (options.orderBy) {
          query = query.order(options.orderBy, {
            ascending: options.ascending ?? true,
          });
        } else if (options.limit === undefined) {
          // Paging needs a stable order.
          query = query.order("id", { ascending: true });
        }

        if (options.limit !== undefined) {
          query = query.limit(options.limit);
        } else {
          query = query.range(from, from + PAGE_SIZE - 1);
        }

        const { data, error } = await query;

        if (error) {
          return {
            data: null,
            error: {
              kind: "query",
              message:
                "Unable to load public data. Check the selected schema and Supabase read policies.",
            },
          };
        }

        const page = (data ?? []) as unknown as Row[];
        rows.push(...page);

        if (options.limit !== undefined || page.length < PAGE_SIZE) break;
      }
    }

    return { data: rows, error: null };
  } catch {
    return {
      data: null,
      error: {
        kind: "query",
        message: "Unable to connect to Supabase public data.",
      },
    };
  }
}
