"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type PublicRider = {
  id: string;
  full_name: string;
  rider_number: string | null;
};

export default function TestRiderAccessPage() {
  const [status, setStatus] = useState("Testing public access...");
  const [riders, setRiders] = useState<PublicRider[]>([]);

  useEffect(() => {
    async function testAccess() {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!url || !anonKey) {
        setStatus(
          "Configuration missing. Check your NEXT_PUBLIC_SUPABASE_URL and public anon/publishable key environment variables.",
        );
        return;
      }

      const supabase = createClient(url, anonKey);

      const { data, error } = await supabase
        .from("public_riders")
        .select("id, full_name, rider_number")
        .limit(5);

      if (error) {
        setStatus(`FAILED: ${error.message}`);
        return;
      }

      setRiders(data ?? []);
      setStatus(
        `SUCCESS: Public view returned ${(data ?? []).length} rider records.`,
      );
    }

    void testAccess();
  }, []);

  return (
    <main className="min-h-screen bg-[#101211] p-8 text-white">
      <h1 className="mb-4 text-2xl font-bold">Public Rider Access Test</h1>
      <p className="mb-6">{status}</p>

      {riders.length > 0 && (
        <table className="text-left">
          <thead>
            <tr>
              <th className="pr-6">Name</th>
              <th>Rider Number</th>
            </tr>
          </thead>
          <tbody>
            {riders.map((rider) => (
              <tr key={rider.id}>
                <td className="pr-6 py-2">{rider.full_name}</td>
                <td>{rider.rider_number ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}