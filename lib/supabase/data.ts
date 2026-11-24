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
};

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

  try {
    let query = client.from(table).select(columns);

    if (options.equals) {
      query = query.eq(options.equals.column, options.equals.value);
    }

    if (options.orderBy) {
      query = query.order(options.orderBy, {
        ascending: options.ascending ?? true,
      });
    }

    if (options.limit !== undefined) {
      query = query.limit(options.limit);
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

    return { data: (data ?? []) as unknown as Row[], error: null };
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